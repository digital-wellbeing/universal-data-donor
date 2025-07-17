import React, { createContext, useState, useEffect, useContext } from 'react';

export const ConfigContext = createContext();

export const useConfig = () => {
  return useContext(ConfigContext);
};

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/config.json`);
        if (!response.ok) {
          throw new Error('Failed to fetch config');
        }
        const data = await response.json();
        setConfig(data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  if (loading) {
    return <div>Loading configuration...</div>;
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
