import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadFooter, decodeContact } from '../utils/footerConfig';

const External = ({ href, children, ...rest }) => {
  if (href.startsWith('/')) return <Link to={href} {...rest}>{children}</Link>; // in-app page, e.g. /about
  const web = /^https?:/i.test(href);
  return (
    <a href={href} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {children}
    </a>
  );
};

/**
 * A phone number or email address kept out of the page until someone asks for it: a button
 * that decodes it on press and replaces itself with the link (focus moves to the link, so
 * keyboard and screen-reader users land on the revealed value).
 */
const Reveal = ({ item }) => {
  const [revealed, setRevealed] = useState(null);
  const linkRef = useRef(null);
  useEffect(() => { if (revealed && linkRef.current) linkRef.current.focus(); }, [revealed]);
  if (revealed) return <a ref={linkRef} href={revealed.href}>{revealed.label}</a>;
  return (
    <button type="button" className="ud-footer-reveal" onClick={() => setRevealed(decodeContact(item))}>
      {item.reveal}
    </button>
  );
};

const FooterLink = ({ item }) => (item.encoded ? <Reveal item={item} /> : <External href={item.href}>{item.label}</External>);

const assetUrl = (src) => (src.startsWith('/') ? `${process.env.PUBLIC_URL}${src}` : src);

/**
 * Site footer: a brand block on the left (logo, name, tagline, © year + holder, GitHub link)
 * and link columns on the right (e.g. Support, Legal). Content from public/footer.json.
 */
export default function Footer({ year = new Date().getFullYear() }) {
  const [footer, setFooter] = useState(null);

  useEffect(() => {
    let active = true;
    loadFooter().then((value) => { if (active) setFooter(value); });
    return () => { active = false; };
  }, []);

  if (!footer) return null;
  const { name, tagline, logo, copyright, github, columns } = footer;

  return (
    <footer className="ud-footer" role="contentinfo">
      <div className="container">
        <div className="row">
          <div className="col-lg-5 mb-4">
            {name && (
              <div className="ud-footer-brand">
                {logo && <img src={assetUrl(logo)} alt="" className="ud-footer-logo" />}
                <span>{name}</span>
              </div>
            )}
            {tagline && <p className="ud-footer-tagline">{tagline}</p>}
            {(copyright || github) && (
              <div className="ud-footer-meta">
                {copyright && <span>&copy; {year} {copyright}</span>}
                {github && (
                  <External href={github} className="ud-footer-icon" aria-label="Source code on GitHub" title="GitHub">
                    <i className="bi bi-github" aria-hidden="true" />
                  </External>
                )}
              </div>
            )}
          </div>
          {columns.length > 0 && (
            <div className="col-lg-7">
              <div className="row justify-content-lg-end">
                {columns.map((col) => (
                  <nav key={col.title} className="col-6 col-sm-4 col-lg-auto px-lg-4 mb-4" aria-label={col.title}>
                    <h2 className="ud-footer-title">{col.title}</h2>
                    <ul className="list-unstyled mb-0">
                      {col.links.map((item) => (
                        <li key={item.href || item.kind}><FooterLink item={item} /></li>
                      ))}
                    </ul>
                  </nav>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
