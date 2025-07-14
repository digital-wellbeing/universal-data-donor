import React from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../ConfigContext';

const Header = () => {
  const config = useConfig();

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark">
      <div className="container">
        <Link className="navbar-brand" to="/">
          {config.header.title}
        </Link>
      </div>
    </nav>
  );
};

export default Header;
