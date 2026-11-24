import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadHeader } from '../utils/headerConfig';

/**
 * Site header panel, the counterpart of the footer: the tool's name (a link to the start
 * page), a one-line description and a link to the About page. Text from public/config/header.json.
 */
export default function Header() {
  const [header, setHeader] = useState(null);

  useEffect(() => {
    let active = true;
    loadHeader().then((value) => { if (active) setHeader(value); });
    return () => { active = false; };
  }, []);

  if (!header) return null;

  return (
    <header className="ud-header">
      <div className="container d-flex flex-wrap align-items-center justify-content-between">
        <div className="ud-header-title">
          <Link className="ud-header-brand" to="/">{header.title}</Link>
          {header.tagline && <div className="ud-header-tagline">{header.tagline}</div>}
        </div>
        <nav aria-label="Main">
          <Link className="ud-header-link" to="/about">About</Link>
        </nav>
      </div>
    </header>
  );
}
