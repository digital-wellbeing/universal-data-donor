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

