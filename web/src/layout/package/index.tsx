import isNull from 'lodash/isNull';
import isUndefined from 'lodash/isUndefined';
import map from 'lodash/map';
import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { FiDownload, FiPlus } from 'react-icons/fi';
import { IoIosArrowBack } from 'react-icons/io';
import { Link, useHistory } from 'react-router-dom';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { tomorrowNightBright } from 'react-syntax-highlighter/dist/cjs/styles/hljs';

import { API } from '../../api';
import useScrollRestorationFix from '../../hooks/useScrollRestorationFix';
import { Package, PackageKind, SearchFiltersURL } from '../../types';
import prepareQueryString from '../../utils/prepareQueryString';
import Image from '../common/Image';
import Loading from '../common/Loading';
import Modal from '../common/Modal';
import NoData from '../common/NoData';
import SubNavbar from '../navigation/SubNavbar';
import ChartInstall from './ChartInstall';
import Details from './Details';
import FalcoInstall from './FalcoInstall';
import ModalHeader from './ModalHeader';
import styles from './PackageView.module.css';
import Readme from './Readme';

interface Props {
  isLoadingPackage: boolean;
  setIsLoadingPackage: Dispatch<SetStateAction<boolean>>;
  searchUrlReferer: SearchFiltersURL | null;
  repoName: string;
  packageName: string;
  version?: string;
  packageKind?: string;
}

const PackageView = (props: Props) => {
  const history = useHistory();
  const [repoName, setRepoName] = useState(props.repoName);
  const [packageName, setPackageName] = useState(props.packageName);
  const [packageKind, setPackageKind] = useState(props.packageKind);
  const [version, setVersion] = useState(props.version);
  const [detail, setDetail] = useState<Package | null | undefined>(undefined);
  const { text, pageNumber, filters, deprecated } = props.searchUrlReferer || {};
  const { isLoadingPackage, setIsLoadingPackage } = props;

  useScrollRestorationFix();

  useEffect(() => {
    if (!isUndefined(props.repoName) && !isLoadingPackage) {
      setRepoName(props.repoName);
      setPackageName(props.packageName);
      setVersion(props.version);
      setPackageKind(props.packageKind);
    }
  }, [props, isLoadingPackage]);

  useEffect(() => {
    setIsLoadingPackage(true);
    async function fetchPackageDetail() {
      try {
        setDetail(
          await API.getPackage({
            repoName: repoName,
            packageName: packageName,
            version: version,
            packageKind: packageKind,
          })
        );
        setIsLoadingPackage(false);
      } catch {
        setDetail(null);
        setIsLoadingPackage(false);
      }
    }
    fetchPackageDetail();
    window.scrollTo(0, 0); // Scroll to top when a new version is loaded
  }, [repoName, packageName, version, packageKind, setIsLoadingPackage]);

  useEffect(() => {
    return () => {
      setIsLoadingPackage(false);
    };
  }, [setIsLoadingPackage]);

  const InstallationModal = (buttonIcon: boolean, buttonType?: string): JSX.Element | null => {
    // OPA policies doesn't have any installation modal info
    if (detail!.kind === PackageKind.Opa) {
      return null;
    }

    return (
      <Modal
        buttonType={buttonType}
        buttonContent={
          <>
            {buttonIcon ? <FiDownload className="mr-2" /> : undefined}
            <span>Install</span>
          </>
        }
        header={<ModalHeader package={detail!} />}
        className={styles.modalInstallationWrapper}
      >
        <>
          {(() => {
            switch (detail!.kind) {
              case PackageKind.Chart:
                return (
                  <ChartInstall name={detail!.name} version={detail!.version} repository={detail!.chartRepository!} />
                );
              case PackageKind.Falco:
                return <FalcoInstall normalizedName={detail!.normalizedName!} />;
              default:
                return null;
            }
          })()}
        </>
      </Modal>
    );
  };

  const getFalcoRules = (): string | undefined => {
    let rules: string | undefined;
    if (
      !isUndefined(detail) &&
      !isNull(detail) &&
      !isNull(detail.data) &&
      !isUndefined(detail.data) &&
      !isUndefined(detail.data.rules)
    ) {
      rules = map(detail.data.rules, 'raw').join(' ');
    }
    return rules;
  };

  const getOPAPolicies = (): string | undefined => {
    let policies: string | undefined;
    if (
      !isUndefined(detail) &&
      !isNull(detail) &&
      !isNull(detail.data) &&
      !isUndefined(detail.data) &&
      !isUndefined(detail.data.policies)
    ) {
      policies = map(detail.data.policies, 'raw').join(' ');
    }
    return policies;
  };

  return (
    <>
      {!isUndefined(text) && !isNull(props.searchUrlReferer) && (
        <SubNavbar>
          <button
            data-testid="goBack"
            className={`btn btn-link btn-sm pl-0 d-flex align-items-center ${styles.link}`}
            onClick={() => {
              history.push({
                pathname: '/packages/search',
                search: prepareQueryString({
                  pageNumber: pageNumber || 1,
                  text: text,
                  filters: filters || {},
                  deprecated: deprecated || false,
                }),
                state: { fromDetail: true },
              });
            }}
          >
            <IoIosArrowBack className="mr-2" />
            Back to "<span className="font-weight-bold">{text}</span>" results
          </button>
        </SubNavbar>
      )}

      <div data-testid="mainPackage" className="position-relative flex-grow-1">
        {isLoadingPackage && <Loading />}

        {!isUndefined(detail) && (
          <>
            {!isNull(detail) && (
              <div className={`jumbotron ${styles.jumbotron}`}>
                <div className="container">
                  <div className="d-flex align-items-center mb-3">
                    <div
                      className={`d-flex align-items-center justify-content-center p-1 overflow-hidden ${styles.imageWrapper}`}
                    >
                      <Image
                        className={styles.image}
                        alt={detail.displayName || detail.name}
                        imageId={detail.logoImageId}
                      />
                    </div>

                    <div className="ml-3">
                      <div className="d-flex flex-row align-items-center">
                        <div className="h3 mb-0">{detail.displayName || detail.name}</div>
                        {!isNull(detail.deprecated) && detail.deprecated && (
                          <div className={`badge badge-pill text-uppercase ml-2 mt-1 ${styles.deprecatedBadge}`}>
                            Deprecated
                          </div>
                        )}
                      </div>

                      {(() => {
                        switch (detail.kind) {
                          case PackageKind.Chart:
                            return (
                              <>
                                <small className="mr-1 text-muted text-uppercase">Repository: </small>
                                <Link
                                  data-testid="link"
                                  to={{
                                    pathname: '/packages/search',
                                    search: prepareQueryString({
                                      pageNumber: 1,
                                      filters: {
                                        repo: [detail.chartRepository!.name],
                                      },
                                      deprecated: false,
                                    }),
                                  }}
                                >
                                  <u className="text-dark">
                                    {detail.chartRepository!.displayName || detail.chartRepository!.name}
                                  </u>
                                </Link>
                              </>
                            );
                          case PackageKind.Falco:
                          case PackageKind.Opa:
                            return (
                              <div>
                                {!isUndefined(detail.organizationName) && detail.organizationName && (
                                  <>
                                    <small className="mr-1 text-uppercase text-muted">Organization: </small>
                                    {!isUndefined(detail.organizationDisplayName) && detail.organizationDisplayName ? (
                                      <>{detail.organizationDisplayName}</>
                                    ) : (
                                      <>{detail.organizationName}</>
                                    )}
                                  </>
                                )}
                              </div>
                            );

                          default:
                            return null;
                        }
                      })()}
                    </div>
                  </div>

                  <p className="mb-0">{detail.description}</p>

                  <div className="d-block d-md-none">
                    <div className="d-inline-block mr-2">
                      <Modal
                        buttonType="btn-outline-secondary mt-4"
                        buttonContent={
                          <>
                            <FiPlus className="mr-2" />
                            <span>Info</span>
                          </>
                        }
                        header={<ModalHeader package={detail} />}
                        className={styles.wrapper}
                      >
                        <Details package={detail} searchUrlReferer={props.searchUrlReferer} />
                      </Modal>
                    </div>

                    <div className="d-inline-block">{InstallationModal(true, 'btn-outline-secondary')}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="container">
              {isNull(detail) && !isLoadingPackage ? (
                <NoData>No data available for this package</NoData>
              ) : (
                <div className="row">
                  {!isNull(detail) && (
                    <>
                      <div className={styles.mainContent}>
                        {isNull(detail.readme) || isUndefined(detail.readme) ? (
                          <NoData>No README file available for this package</NoData>
                        ) : (
                          <Readme markdownContent={detail.readme} />
                        )}

                        {(() => {
                          switch (detail.kind) {
                            case PackageKind.Falco:
                              let rules: string | undefined = getFalcoRules();
                              return (
                                <>
                                  {!isUndefined(rules) && (
                                    <div className="mb-5">
                                      <div className="h2 mb-4">Rules</div>
                                      <SyntaxHighlighter
                                        language="yaml"
                                        style={tomorrowNightBright}
                                        customStyle={{ padding: '1.5rem' }}
                                      >
                                        {rules}
                                      </SyntaxHighlighter>
                                    </div>
                                  )}
                                </>
                              );

                            case PackageKind.Opa:
                              let policies: string | undefined = getOPAPolicies();
                              return (
                                <>
                                  {!isUndefined(policies) && (
                                    <div className="mb-5">
                                      <div className="h2 mb-4">Policies</div>
                                      <SyntaxHighlighter
                                        language="rego"
                                        style={tomorrowNightBright}
                                        customStyle={{ padding: '1.5rem' }}
                                      >
                                        {policies}
                                      </SyntaxHighlighter>
                                    </div>
                                  )}
                                </>
                              );

                            default:
                              return null;
                          }
                        })()}
                      </div>
                    </>
                  )}

                  <div className="col col-auto pl-5 pb-4 d-none d-md-block">
                    {!isNull(detail) && (
                      <>
                        {InstallationModal(false)}

                        <div className={`card shadow-sm position-relative ${styles.info}`}>
                          <div className="card-body">
                            <Details package={detail} searchUrlReferer={props.searchUrlReferer} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default PackageView;
