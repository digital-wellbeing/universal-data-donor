import React, { createContext, useState, useEffect, useContext } from 'react';
import PlatformSelector from './components/PlatformSelector';

export const ConfigContext = createContext();

export const useConfig = () => {
  return useContext(ConfigContext);
};

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);

  const fetchConfig = async (platform) => {
    try {
      setLoading(true);

      // Validate platform to prevent directory traversal
      const validPlatforms = ['playstation', 'android'];
      const safePlatform = validPlatforms.includes(platform) ? platform : 'playstation';

      const response = await fetch(`${process.env.PUBLIC_URL}/config-${safePlatform}.json`);
      if (!response.ok) {
        throw new Error('Failed to fetch config');
      }
      const data = await response.json();
      setConfig(data);
      setShowPlatformSelector(false);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Get platform from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const platform = urlParams.get('platform');

    if (platform) {
      // Platform specified in URL, load config directly
      fetchConfig(platform);
    } else {
      // No platform specified, show selector
      setShowPlatformSelector(true);
      setLoading(false);
    }
  }, []);

  const handlePlatformSelect = (platform) => {
    fetchConfig(platform);
  };

  if (loading) {
    return <div>Loading configuration...</div>;
  }

  if (showPlatformSelector) {
    return <PlatformSelector onSelectPlatform={handlePlatformSelect} />;
  }

  if (error) {
    return <div>Error loading configuration: {error.message}</div>;
  }

  return (
    <ConfigContext.Provider value={config}>
      {children}
    </ConfigContext.Provider>
  );
};
