import React from 'react';
import { useLocation } from 'react-router-dom';
import CopyToClipboard from '../components/CopyToClipboard';
import { useConfig } from '../ConfigContext';

const ThankYouPage = () => {
  const config = useConfig();
  const location = useLocation();
  const donated = location.state?.donated;
  const submissionId = location.state?.submissionId;

  if (!config || !config.page || !config.page.thankyou) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mt-5">
      <div className="card text-center">
        <div className="card-header">
          <h2>{config.page.thankyou.title}</h2>
        </div>
        <div className="card-body">
          {donated ? (
            <>
              <p>{config.page.thankyou.successMessage}</p>
              {submissionId && (
                <div className="mt-4 mb-4">
                  <h5>{config.page.thankyou.submissionId}</h5>
                  <CopyToClipboard text={submissionId} />
                  <small className="text-muted d-block mt-2">
                    {config.page.thankyou.saveId}
                  </small>
                </div>
              )}
            </>
          ) : (
            <p>{config.page.thankyou.declineMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThankYouPage;