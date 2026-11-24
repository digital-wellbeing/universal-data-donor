import React, { useEffect, useState } from 'react';
import { loadAbout } from '../utils/aboutConfig';
import BackButton from '../components/BackButton';

/** About page: what the tool is, where its source is, and who built it. Needs no platform config. */
export default function AboutPage() {
  const [about, setAbout] = useState(undefined); // undefined = loading, null = nothing to show
  useEffect(() => {
    let active = true;
    loadAbout().then((value) => { if (active) setAbout(value); });
    return () => { active = false; };
  }, []);

  if (about === undefined) return null;

  return (
    <div className="container mt-5">
      <div className="card">
        <div className="card-header">
          <h1 className="h2 mb-0">{about ? about.title : 'About'}</h1>
        </div>
        <div className="card-body">
          {!about && <p className="mb-0">There is no information to show here.</p>}
          {about && about.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {about && about.source && (
            <p>
              <a href={about.source.href} target="_blank" rel="noopener noreferrer">{about.source.label}</a>
            </p>
          )}
          {about && about.people.length > 0 && (
            <section aria-labelledby="about-team">
              <h2 className="h4 mt-4 mb-3" id="about-team">{about.peopleTitle}</h2>
              <ul className="ud-people list-unstyled mb-0">
                {about.people.map((person) => (
                  <li key={person.name} className={`ud-person${person.newRow ? ' ud-person-newrow' : ''}`}>
                    {!person.photo && (
                      <span className="ud-person-photo ud-person-placeholder" aria-hidden="true">
                        <svg viewBox="0 0 72 72" width="72" height="72" focusable="false">
                          <circle cx="36" cy="28" r="12" fill="currentColor" />
                          <path d="M12 72c0-14 11-24 24-24s24 10 24 24z" fill="currentColor" />
                        </svg>
                      </span>
                    )}
                    {person.photo && (
                      <img
                        className="ud-person-photo"
                        src={`${process.env.PUBLIC_URL}/${person.photo}`}
                        alt=""
                        width="72"
                        height="72"
                        loading="lazy"
                        onError={(event) => { event.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <div>
                      <strong>
                        {person.href
                          ? <a href={person.href} target="_blank" rel="noopener noreferrer">{person.name}</a>
                          : person.name}
                      </strong>
                      {person.role && <div>{person.role}</div>}
                      {person.detail && <div className="ud-person-detail">{person.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <BackButton />
        </div>
      </div>
    </div>
  );
}
