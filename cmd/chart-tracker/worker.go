package main

import (
	"context"
	"errors"
	"fmt"
	"image"
	"io/ioutil"
	"net/http"
	"net/url"
	"path"
	"runtime/debug"
	"sync"
	"time"

	"github.com/artifacthub/hub/internal/api"
	"github.com/artifacthub/hub/internal/hub"
	"github.com/artifacthub/hub/internal/img"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
)

// worker is in charge of handling jobs generated by the dispatcher.
type worker struct {
	ctx        context.Context
	id         int
	ec         *errorsCollector
	hubAPI     *api.API
	imageStore img.Store
	logger     zerolog.Logger
	httpClient *http.Client
}

// newWorker creates a new worker instance.
func newWorker(ctx context.Context, id int, ec *errorsCollector, hubAPI *api.API, imageStore img.Store) *worker {
	return &worker{
		ctx:        ctx,
		id:         id,
		ec:         ec,
		hubAPI:     hubAPI,
		imageStore: imageStore,
		logger:     log.With().Int("worker", id).Logger(),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// run instructs the worker to start handling jobs. It will keep running until
// the jobs queue is closed or the context is done.
func (w *worker) run(wg *sync.WaitGroup, queue chan *job) {
	defer wg.Done()
	for {
		select {
		case j, ok := <-queue:
			if !ok {
				return
			}
			md := j.chartVersion.Metadata
			w.logger.Debug().
				Str("repo", j.repo.Name).
				Str("chart", md.Name).
				Str("version", md.Version).
				Msg("Handling job")
			if err := w.handleJob(j); err != nil {
				w.logger.Error().
					Err(err).
					Str("repo", j.repo.Name).
					Str("chart", md.Name).
					Str("version", md.Version).
					Msg("Error handling job")
			}
		case <-w.ctx.Done():
			return
		}
	}
}

// handleJob handles the provided job. This involves downloading the chart
// archive, extracting its contents and register the corresponding package.
func (w *worker) handleJob(j *job) error {
	defer func() {
		if r := recover(); r != nil {
			w.logger.Error().
				Str("repo", j.repo.Name).
				Str("chart", j.chartVersion.Metadata.Name).
				Str("version", j.chartVersion.Metadata.Version).
				Bytes("stacktrace", debug.Stack()).
				Interface("recorver", r).
				Msg("handleJob panic")
		}
	}()

	// Prepare chart archive url
	u := j.chartVersion.URLs[0]
	if _, err := url.ParseRequestURI(u); err != nil {
		tmp, err := url.Parse(j.repo.URL)
		if err != nil {
			w.ec.append(j.repo.ChartRepositoryID, fmt.Errorf("invalid chart url: %s", u))
			w.logger.Error().Str("url", u).Msg("invalid url")
			return err
		}
		tmp.Path = path.Join(tmp.Path, u)
		u = tmp.String()
	}

	// Load chart from remote archive
	chart, err := w.loadChart(u)
	if err != nil {
		w.ec.append(j.repo.ChartRepositoryID, fmt.Errorf("error loading chart %s: %w", u, err))
		w.logger.Warn().
			Str("repo", j.repo.Name).
			Str("chart", j.chartVersion.Metadata.Name).
			Str("version", j.chartVersion.Metadata.Version).
			Str("url", u).
			Msg("Chart load failed")
		return nil
	}
	md := chart.Metadata

	// Store chart logo when available if requested
	var logoURL, logoImageID string
	if j.downloadLogo {
		if md.Icon != "" {
			logoURL = md.Icon
			data, err := w.downloadImage(md.Icon)
			if err != nil {
				w.ec.append(j.repo.ChartRepositoryID, fmt.Errorf("error dowloading logo %s: %w", md.Icon, err))
				w.logger.Debug().Err(err).Str("url", md.Icon).Msg("Image download failed")
			} else {
				logoImageID, err = w.imageStore.SaveImage(w.ctx, data)
				if err != nil && !errors.Is(err, image.ErrFormat) {
					w.logger.Warn().Err(err).Str("url", md.Icon).Msg("Save image failed")
				}
			}
		}
	}

	// Prepare hub package to be registered
	p := &hub.Package{
		Kind:            hub.Chart,
		Name:            md.Name,
		Description:     md.Description,
		HomeURL:         md.Home,
		LogoURL:         logoURL,
		LogoImageID:     logoImageID,
		Keywords:        md.Keywords,
		Deprecated:      md.Deprecated,
		Version:         md.Version,
		AppVersion:      md.AppVersion,
		Digest:          j.chartVersion.Digest,
		ChartRepository: j.repo,
	}
	readme := getFile(chart, "README.md")
	if readme != nil {
		p.Readme = string(readme.Data)
	}
	var maintainers []*hub.Maintainer
	for _, entry := range md.Maintainers {
		if entry.Email != "" {
			maintainers = append(maintainers, &hub.Maintainer{
				Name:  entry.Name,
				Email: entry.Email,
			})
		}
	}
	if len(maintainers) > 0 {
		p.Maintainers = maintainers
	}

	// Register package
	err = w.hubAPI.Packages.Register(w.ctx, p)
	if err != nil {
		w.ec.append(
			j.repo.ChartRepositoryID,
			fmt.Errorf("error registering package %s version %s: %w", p.Name, p.Version, err),
		)
	}
	return err
}

// loadChart loads a chart from a remote archive located at the url provided.
func (w *worker) loadChart(u string) (*chart.Chart, error) {
	resp, err := w.httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		chart, err := loader.LoadArchive(resp.Body)
		if err != nil {
			return nil, err
		}
		return chart, nil
	}
	return nil, fmt.Errorf("unexpected status code received: %d", resp.StatusCode)
}

// downloadImage downloads the image located at the url provided.
func (w *worker) downloadImage(u string) ([]byte, error) {
	resp, err := w.httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return ioutil.ReadAll(resp.Body)
	}
	return nil, fmt.Errorf("unexpected status code received: %d", resp.StatusCode)
}

// getFile returns the file requested from the provided chart.
func getFile(chart *chart.Chart, name string) *chart.File {
	for _, file := range chart.Files {
		if file.Name == name {
			return file
		}
	}
	return nil
}
