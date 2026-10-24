import React from 'react';
import { Box, Container, Typography } from '@mui/material';
import './PlatformSelector.css';

// Homepage sections, in display order. Every platform names one via `group`.
const PLATFORM_GROUPS = [
  { id: 'health', label: 'Health & wearables' },
  { id: 'screen', label: 'Screen time & gaming' },
  { id: 'social', label: 'Social media' },
];

const PlatformSelector = ({ onSelectPlatform }) => {
  const platforms = [
    {
      id: 'playstation',
      group: 'screen',
      name: 'PlayStation',
      logo: '/playstation-svgrepo-com.svg',
      description: 'Donate your PlayStation gaming data',
      color: '#003791'
    },
    {
      id: 'android',
      group: 'screen',
      name: 'Google Play Games',
      logo: '/android-logo.svg',
      description: 'Donate your Google Play Games data',
      color: '#3DDC84'
    },
    {
      id: 'activitywatch',
      group: 'screen',
      name: 'ActivityWatch',
      logo: '/activitywatch-logo.svg',
      description: 'Donate your ActivityWatch usage data',
      color: '#5C5CD6'
    },
    {
      id: 'googlefit',
      group: 'health',
      name: 'Google Fit',
      logo: '/googlefit-logo.svg',
      description: 'Donate your Google Fit activity data',
      color: '#1A73E8'
    },
    {
      id: 'garmin',
      group: 'health',
      name: 'Garmin',
      logo: '/garmin-logo.svg',
      description: 'Donate your Garmin wearable health data',
      color: '#006BB6'
    },
    {
      id: 'applehealth',
      group: 'health',
      name: 'Apple Health',
      logo: '/applehealth-logo.svg',
      description: 'Donate your iPhone and Apple Watch health data',
      color: '#E0234E'
    },
    {
      id: 'healthconnect',
      group: 'health',
      name: 'Health Connect',
      logo: '/healthconnect-logo.svg',
      description: 'Donate the health data your Android apps and wearables share',
      color: '#3B7A57'
    },
    {
      id: 'fitbit',
      group: 'health',
      name: 'Fitbit',
      logo: '/fitbit-logo.svg',
      description: 'Donate your Fitbit / Google Health data via Google Takeout',
      color: '#008C94'
    },
    {
      id: 'samsunghealth',
      group: 'health',
      name: 'Samsung Health',
      logo: '/samsunghealth-logo.svg',
      description: 'Donate your Galaxy Watch and Samsung Health data',
      color: '#15965F'
    },
    {
      id: 'instagram',
      group: 'social',
      name: 'Instagram',
      logo: '/instagram-logo.svg',
      description: 'Donate counts of your Instagram activity (no content)',
      color: '#C13584'
    }
  ];

  // Only these platforms are shown on the homepage. The others remain fully
  // functional via a direct ?platform=<id> URL — add an id here to re-enable it.
  const ENABLED_PLATFORM_IDS = ['activitywatch', 'googlefit', 'garmin', 'applehealth', 'healthconnect', 'fitbit', 'samsunghealth', 'instagram'];
  const visiblePlatforms = platforms.filter((p) => ENABLED_PLATFORM_IDS.includes(p.id));

  const handlePlatformClick = (platformId) => {
    // Update URL with platform parameter
    const url = new URL(window.location);
    url.searchParams.set('platform', platformId);
    window.history.pushState({}, '', url);

    // Notify parent component
    onSelectPlatform(platformId);
  };

  return (
    <Box className="platform-selector-wrapper">
      <Container maxWidth="lg" className="platform-selector-container">
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography variant="h2" component="h1" className="platform-selector-title">
            Universal Data Donor
          </Typography>
          <Typography variant="h5" className="platform-selector-subtitle">
            Select the platform you want to donate data from
          </Typography>
        </Box>

        <div className="platform-groups">
          {PLATFORM_GROUPS.map((group) => {
            const groupPlatforms = visiblePlatforms.filter((p) => p.group === group.id);
            if (groupPlatforms.length === 0) return null;
            return (
              <section
                key={group.id}
                className="platform-group"
                data-count={Math.min(groupPlatforms.length, 3)}
                aria-labelledby={`group-${group.id}`}
              >
                <h2 id={`group-${group.id}`} className="platform-group-title">{group.label}</h2>
                <ul className="platform-grid">
                  {groupPlatforms.map((platform) => (
                    <li key={platform.id} className="platform-grid-item">
                      <button
                        type="button"
                        className="platform-card"
                        style={{ '--platform-color': platform.color }}
                        onClick={() => handlePlatformClick(platform.id)}
                      >
                        <span className="platform-logo-container">
                          <img
                            src={process.env.PUBLIC_URL + platform.logo}
                            alt=""
                            className="platform-logo"
                          />
                        </span>
                        <span className="platform-name">{platform.name}</span>
                        <span className="platform-description">{platform.description}</span>
                        <span className="platform-select-btn" aria-hidden="true">Select</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Container>
    </Box>
  );
};

export default PlatformSelector;
