import React, { useState } from 'react';
import './App.css';
import { Route, Routes } from 'react-router-dom';
import ConsentPage from './pages/ConsentPage';
import UploadPage from './pages/UploadPage';
import FilterPage from './pages/FilterPage';
import ThankYouPage from './pages/ThankYouPage';

function App() {
  const [parsedData, setParsedData] = useState(null);

  return (
    <>
      <Routes>
        <Route path="/" element={<ConsentPage />} />
        <Route path="/upload" element={<UploadPage setParsedData={setParsedData} />} />
        <Route path="/filter" element={<FilterPage parsedData={parsedData} />} />
        <Route path="/thank-you" element={<ThankYouPage />} />
      </Routes>
    </>
  );
}

export default App;