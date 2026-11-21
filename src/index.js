import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './theme.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from './ConfigContext';
import ThemeLoader from './ThemeLoader';
import Header from './components/Header';
import Footer from './components/Footer';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeLoader>
      <BrowserRouter basename="/datadonation">
        <div className="ud-app">
          <a className="ud-skip-link" href="#main-content">Skip to main content</a>
          <Header />
          <main id="main-content" className="ud-app-main" tabIndex={-1}>
            <ConfigProvider>
              <App />
            </ConfigProvider>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </ThemeLoader>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();