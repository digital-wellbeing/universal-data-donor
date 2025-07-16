import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { getParser } from '../utils/parserFactory';
import { useConfig } from '../ConfigContext';

const UploadPage = ({ setParsedData }) => {
  const config = useConfig();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsingWarning, setParsingWarning] = useState(null);
  const [parsedDataCache, setParsedDataCache] = useState(null); // eslint-disable-line no-unused-vars
  const navigate = useNavigate();

  if (!config || !config.page || !config.page.upload) {
    return <div>Loading...</div>;
  }

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      // Reset warning and cached data when new file is selected
      setParsingWarning(null);
      setParsedDataCache(null);
    }
  };

  // Function to check if parsing errors indicate a potentially incorrect file
  const checkForSignificantParsingErrors = (parsingErrors, parsedData) => {
    // Check if there's at least one non-empty sheet with actual data
    let hasNonEmptySheet = false;
    
    for (const sheetName in parsedData) {
      const sheetData = parsedData[sheetName];
      if (sheetData && sheetData.length > 0) {
        hasNonEmptySheet = true;
        break;
      }
    }
    
    // If no sheets have any data, show warning
    return !hasNonEmptySheet;
  };

  const handleProceed = async () => {
    if (file) {
      setLoading(true);
      try {
        // Dynamically load the parser based on config
        const parser = await getParser(config.general.parser);
        // Parse the file before navigating
        const parseResult = await parser(file);
        const parsed = parseResult.data;
        const parsingErrors = parseResult.parsingErrors;
        
        // Check for significant parsing errors
        if (checkForSignificantParsingErrors(parsingErrors, parsed)) {
          // Cache the parsed data but show warning instead of proceeding
          setParsedDataCache({ parsed, parsingErrors });
          setParsingWarning({
            sheetsNotFound: parsingErrors.sheetsNotFound,
            tablesNotParsed: parsingErrors.tablesNotParsed
          });
          setLoading(false);
          return;
        }
        
        // Process the parsed data similar to FilterPage
        const processedData = {};
        const initialSelection = {};
        let idCounter = 0;
        
        for (const sheetName in parsed) {
          const cleanSheetName = sheetName.replace(/"/g, '');
          const sheetData = parsed[sheetName];
          const processedSheetData = [];
          
          for (let i = 0; i < sheetData.length; i++) {
            processedSheetData.push({
              ...sheetData[i],
              id: idCounter++,
            });
          }
          
          processedData[cleanSheetName] = processedSheetData;
          initialSelection[cleanSheetName] = processedSheetData.map(row => row.id);
        }
        
        // Set the parsed data with initial selection and parsing errors
        setParsedData({ 
          data: processedData, 
          selectionModel: initialSelection,
          parsingErrors: parsingErrors
        });
        
        // Navigate to filter page only after parsing is complete
        navigate('/filter');
      } catch (error) {
        console.error('Error parsing file:', error);
        alert('Error parsing file: ' + error.message);
      } finally {
        setLoading(false);
      }
    }
  };



  const handleTryAgain = () => {
    setParsingWarning(null);
    setParsedDataCache(null);
    setFile(null);
  };

  return (
    <div className="container mt-5">
      <div className="card">
        <div className="card-header">
          <h2>{config.page.upload.title}</h2>
        </div>
        <div className="card-body">
          <p className="mb-3">
            {config.page.upload.intro}
          </p>
          <div className="d-block">
            <Button
              component="label"
              variant="contained"
              sx={{ display: 'block', width: 'fit-content' }}
            >
              {config.page.upload.uploadButton}
              <input
                type="file"
                hidden
                onChange={handleFileChange}
                accept={config.general.fileExtensions.join(',')}
              />
            </Button>
          </div>
          {file && !parsingWarning && (
            <div className="alert alert-info mt-3">
              {config.page.upload.selectedFile} {file.name}
            </div>
          )}
          {loading && (
            <div className="alert alert-warning mt-3">
              <div className="d-flex align-items-center">
                <CircularProgress size={20} className="me-2" />
                <span>{config.page.upload.processing}</span>
              </div>
            </div>
          )}
          
          {/* PlayStation File Warning */}
          {parsingWarning && (
            <Alert severity="warning" sx={{ mt: 3 }}>
              <AlertTitle>{config.page.upload.noDataFound}</AlertTitle>
              <p>
                <strong>{config.page.upload.incorrectFile}</strong>
              </p>
              <p>
                {config.page.upload.possibleIssues}
              </p>
              <ul>
                {config.page.upload.issuePoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
              

              
              {parsingWarning.tablesNotParsed.length > 0 && (
                <div className="mt-2">
                  <strong>{config.page.upload.unparseableSheets}</strong>
                  <ul>
                    {parsingWarning.tablesNotParsed.map((error, index) => (
                      <li key={index}>{error.sheetName.replace(/"/g, '')} - {error.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <p className="mt-3">
                <strong>{config.page.upload.checkFile}</strong>
              </p>
              
              <div className="d-flex gap-2 mt-3">
                <Button 
                  variant="contained" 
                  color="primary" 
                  onClick={handleTryAgain}
                >
                  {config.page.upload.tryAgainButton}
                </Button>
              </div>
            </Alert>
          )}
          
          <p className="mt-3 mb-2">
            <strong>{config.page.upload.note.split(':')[0]}:</strong> {config.page.upload.note.split(':')[1]}
          </p>
          <div className="d-block">
            <Button
              data-testid="proceed-button"
              className="btn btn-primary mt-3"
              onClick={handleProceed}
              disabled={!file || loading || parsingWarning}
              variant="contained"
              sx={{ display: 'block', width: 'fit-content' }}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
            >
              {loading ? config.page.upload.processingButton : config.page.upload.proceedButton}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadPage
