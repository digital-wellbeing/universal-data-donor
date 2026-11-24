import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../ConfigContext';
import { getStudyInfo, insertStudyInfo } from '../utils/studyInfo';

const ConsentPage = () => {
  const config = useConfig();
  const [agreed, setAgreed] = useState(false);
  const navigate = useNavigate();

  const handleAgree = () => {
    if (agreed) {
      navigate('/upload');
    }
  };

  if (!config || !config.page || !config.page.consent) {
    return <div>Loading...</div>;
  }

  const consent = config.page.consent;
  // Optional: a service-by-service statement of what is requested and what is read.
  const scope = consent.dataScope;
  // Optional: who runs the study, how data is stored and used, and how to withdraw.
  const sections = Array.isArray(consent.sections) ? consent.sections : [];
  // TODO(ethics): once the ethics committee has approved the study, replace `page.consent.ethics`
  // with the approval reference in all 11 public/config-*.json files (it currently says the study
  // is awaiting review). Then update the "awaiting review" assertion in ConsentPage.test.js.
  // When the config states the ethics status itself, that statement is the only one shown:
  // the ?ethics= URL parameter is free text anyone can set, so it must not contradict it.
  const urlInfo = getStudyInfo();
  const shownInfo = consent.ethics && urlInfo ? { ...urlInfo, ethics: null } : urlInfo;

  return (
    <div className="container mt-5">
      <div className="card">
        <div className="card-header">
          <div className="d-flex align-items-center gap-3">
            <img
              src={process.env.PUBLIC_URL + config.header.logo}
              alt={config.header.logoAlt}
              width="40"
              height="40"
              style={{ flexShrink: 0, marginRight: '12px' }}
            />
            <h1 className="h2 mb-0">{config.page.consent.title}</h1>
          </div>
        </div>
        <div className="card-body">
          <p>{insertStudyInfo(consent.intro, shownInfo)}</p>
          {consent.ethics && <p data-testid="ethics-statement"><strong>{consent.ethics}</strong></p>}
          <p>{consent.process}</p>
          {scope && (
            <div className="mb-3 p-3 border rounded bg-light" data-testid="data-scope">
              <h2 className="h6">{scope.title}</h2>
              {scope.intro && <p className="mb-2">{scope.intro}</p>}
              <ul>
                {(scope.services || []).map((service) => (
                  <li key={service.name} className="mb-2">
                    <strong>{service.name}</strong>
                    <div>
                      <span className="fw-semibold">{scope.readLabel || 'Read:'}</span> {service.read}
                    </div>
                    <div className="text-muted">
                      <span className="fw-semibold">{scope.notReadLabel || 'Not read:'}</span> {service.notRead}
                    </div>
                  </li>
                ))}
              </ul>
              {scope.subsetNote && <p className="mb-2">{scope.subsetNote}</p>}
              {scope.otherServices && <p className="mb-0">{scope.otherServices}</p>}
            </div>
          )}
          {sections.map((section) => (
            <section key={section.title} className="mb-3" data-testid="consent-section">
              <h2 className="h6">{section.title}</h2>
              {(section.paragraphs || []).map((text) => <p key={text} className="mb-2">{text}</p>)}
              {section.items && (
                <ul className="mb-2">
                  {section.items.map((text) => <li key={text}>{text}</li>)}
                </ul>
              )}
              {(section.links || []).map((link) => (
                <p key={link.href} className="mb-2">
                  {/^https?:/i.test(link.href)
                    ? <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
                    : <a href={link.href}>{link.label}</a>}
                </p>
              ))}
            </section>
          ))}
          <p><strong>{config.page.consent.donationAgreement}</strong></p>
          <ul>
            {config.page.consent.agreementPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
          <div className="form-check mt-4">
            <input
              type="checkbox"
              className="form-check-input"
              id="agreeCheck"
              checked={agreed}
              onChange={() => setAgreed(!agreed)}
            />
            <label className="form-check-label" htmlFor="agreeCheck">
              {config.page.consent.agreementCheckbox}
            </label>
          </div>
          <button
            className="btn btn-primary mt-3"
            onClick={handleAgree}
            disabled={!agreed}
          >
            {config.page.consent.agreeButton}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentPage

