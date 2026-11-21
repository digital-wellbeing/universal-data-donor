import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadFooter } from '../utils/footerConfig';

const External = ({ href, children }) => {
  if (href.startsWith('/')) return <Link to={href}>{children}</Link>; // in-app page, e.g. /about
  const web = /^https?:/i.test(href);
  return (
    <a href={href} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
};

/** Site footer: organisation, address with map link, phone, contact, legal links and © year (the copyright holder is its own setting, never the organisation). */
export default function Footer({ year = new Date().getFullYear() }) {
  const [footer, setFooter] = useState(null);

  useEffect(() => {
    let active = true;
    loadFooter().then((value) => { if (active) setFooter(value); });
    return () => { active = false; };
  }, []);

  if (!footer) return null;
  const { organisation, copyright, address, map, phone, contact, links, linksTitle } = footer;
  const hasContactColumn = phone || contact;

  return (
    <footer className="ud-footer" role="contentinfo">
      <div className="container">
        <div className="row">
          {(organisation || address.length > 0 || map) && (
            <div className="col-md mb-3">
              <h2 className="ud-footer-title">{organisation || 'Address'}</h2>
              {address.length > 0 && (
                <address className="mb-2">
                  {address.map((line) => <div key={line}>{line}</div>)}
                </address>
              )}
              {map && <External href={map.href}>{map.label}</External>}
            </div>
          )}
          {hasContactColumn && (
            <div className="col-md mb-3">
              <h2 className="ud-footer-title">Contact</h2>
              <ul className="list-unstyled mb-0">
                {phone && <li><External href={phone.href}>{phone.label}</External></li>}
                {contact && <li><External href={contact.href}>{contact.label}</External></li>}
              </ul>
            </div>
          )}
          {links.length > 0 && (
            <div className="col-md mb-3">
              <h2 className="ud-footer-title">{linksTitle}</h2>
              <ul className="list-unstyled mb-0">
                {links.map((item) => <li key={item.href}><External href={item.href}>{item.label}</External></li>)}
              </ul>
            </div>
          )}
        </div>
        {copyright && (
          <div className="ud-footer-bottom">&copy; {year} {copyright}</div>
        )}
      </div>
    </footer>
  );
}
