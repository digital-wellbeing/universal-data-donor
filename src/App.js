import React, { useState } from 'react';
import './App.css';
import { Route, Routes } from 'react-router-dom';
import ConsentPage from './pages/ConsentPage';
import UploadPage from './pages/UploadPage';
import FilterPage from './pages/FilterPage';
import ThankYouPage from './pages/ThankYouPage';
import AboutPage from './pages/AboutPage';
import ContentPage from './pages/ContentPage';

function App() {
  const [parsedData, setParsedData] = useState(null);

  return (
    <>
      <Routes>
        <Route path="/" element={<ConsentPage />} />
        <Route path="/upload" element={<UploadPage setParsedData={setParsedData} />} />
        <Route path="/filter" element={<FilterPage parsedData={parsedData} />} />
        <Route path="/thank-you" element={<ThankYouPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/cookies" element={<ContentPage slug="cookies" />} />
        <Route path="/accessibility" element={<ContentPage slug="accessibility" />} />
      </Routes>
    </>
  );
}

export default App;