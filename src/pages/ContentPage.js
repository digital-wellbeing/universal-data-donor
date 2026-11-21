import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { loadContent } from '../utils/contentConfig';
import BackButton from '../components/BackButton';

const External = ({ href, children }) => (
  <a href={href} {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
);

/** A statement page (cookies, accessibility) whose text comes from public/content/<slug>.json. */
export default function ContentPage({ slug: fixedSlug }) {
  const params = useParams();
  const slug = fixedSlug || params.slug;
  const [page, setPage] = useState(undefined); // undefined = loading, null = nothing to show

  useEffect(() => {
    let active = true;
    setPage(undefined);
    loadContent(slug).then((value) => { if (active) setPage(value); });
    return () => { active = false; };
  }, [slug]);

  if (page === undefined) return null;

  return (
    <div className="container mt-5">
      <div className="card">
        <div className="card-header">
          <h1 className="h2 mb-0">{page ? page.title : 'Page not found'}</h1>
        </div>
        <div className="card-body">
          {!page && <p className="mb-0">There is no information to show here.</p>}
          {page && page.intro && <p className="lead">{page.intro}</p>}
          {page && page.sections.map((section, index) => (
            <section key={section.heading || index} aria-labelledby={`content-s${index}`} className="mt-4">
              {section.heading && <h2 className="h4" id={`content-s${index}`}>{section.heading}</h2>}
              {section.paragraphs.map((p) => <p key={p}>{p}</p>)}
              {section.items.length > 0 && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
              {section.links.length > 0 && (
                <p>{section.links.map((l) => <span key={l.href} className="mr-3"><External href={l.href}>{l.label}</External></span>)}</p>
              )}
            </section>
          ))}
          <BackButton />
        </div>
      </div>
    </div>
  );
}
