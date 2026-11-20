import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../ConfigContext';

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

  // Optional: a service-by-service statement of what is requested and what is read.
  const scope = config.page.consent.dataScope;

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
            <h2 className="mb-0">{config.page.consent.title}</h2>
          </div>
        </div>
        <div className="card-body">
          <p>{config.page.consent.intro}</p>
          <p>{config.page.consent.process}</p>
          {scope && (
            <div className="mb-3 p-3 border rounded bg-light" data-testid="data-scope">
              <h3 className="h6">{scope.title}</h3>
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

