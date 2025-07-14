import React, { useState } from 'react';
import { useConfig } from '../ConfigContext';

const CopyToClipboard = ({ text }) => {
  const config = useConfig();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('Failed to copy text: ', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Add robust config checking
  if (!config || !config.page || !config.page.thankyou || !config.page.thankyou.copyToClipboard) {
    return <div>Loading...</div>;
  }

  return (
    <div className="d-flex align-items-center gap-2 justify-content-center">
      <div className="border rounded p-2 bg-light font-monospace">
        <strong>{text}</strong>
      </div>
      <button
        className={`btn ${copied ? 'btn-success' : 'btn-outline-primary'}`}
        onClick={handleCopy}
        disabled={copied}
      >
        {copied ? (
          <>
            <i className="bi bi-check-lg"></i> {config.page.thankyou.copyToClipboard.copied}
          </>
        ) : (
          <>
            <i className="bi bi-clipboard"></i> {config.page.thankyou.copyToClipboard.copy}
          </>
        )}
      </button>
    </div>
  );
};

export default CopyToClipboard; 