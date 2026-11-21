import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConfig } from '../ConfigContext';

/**
 * "Back" for pages that work without a platform. Inside the app (a platform is loaded) it
 * steps back; when the page was opened directly it goes to the start page instead, because
 * stepping back into a page that needs a platform would break.
 */
export default function BackButton() {
  const navigate = useNavigate();
  const config = useConfig(); // null when no platform is loaded
  const canGoBack = Boolean(config && window.history.state && window.history.state.idx > 0);
  if (canGoBack) return <button type="button" className="btn btn-primary mt-4" onClick={() => navigate(-1)}>Back</button>;
  if (config) return <Link className="btn btn-primary mt-4" to="/">Back to start</Link>;
  return <a className="btn btn-primary mt-4" href="/datadonation/">Back to start</a>;
}
