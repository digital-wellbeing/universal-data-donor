import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { getParser } from '../utils/parserFactory';
import { getValidator } from '../utils/validatorFactory';
import { useConfig } from '../ConfigContext';
import { filesFromDataTransfer, filterByExtension, mergeFiles } from '../utils/collectFiles';

const formatSize = (bytes) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const UploadPage = ({ setParsedData }) => {
  const config = useConfig();
  const [files, setFiles] = useState([]); // one entry, or several for multi-part exports
  const [ignoredCount, setIgnoredCount] = useState(0); // picked or dropped files with the wrong type
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // whole percent, for streaming parsers
  const [parsingWarning, setParsingWarning] = useState(null);
  const [parsedDataCache, setParsedDataCache] = useState(null); // eslint-disable-line no-unused-vars
  const navigate = useNavigate();

  if (!config || !config.page || !config.page.upload) {
    return <div>Loading...</div>;
  }

  const multiple = Boolean(config.general.multipleFiles);

  // Takes files from the picker, the folder picker or a drop. Multi-part platforms accumulate
  // the selection (so a second pick adds to the first); the others keep a single file.
  const addFiles = (incoming) => {
    const { accepted, ignored } = filterByExtension(incoming, config.general.fileExtensions);
    setIgnoredCount(ignored.length);
    if (accepted.length === 0) return;
    setFiles((current) => (multiple ? mergeFiles(current, accepted) : [accepted[0]]));
    // Reset warning and cached data when the selection changes
    setParsingWarning(null);
    setParsedDataCache(null);
  };

  const handleFileChange = (e) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = ''; // lets the same file(s) be chosen again after removing them
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    if (loading) return;
    addFiles(await filesFromDataTransfer(e.dataTransfer));
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // required for the drop event to fire
    if (!dragging) setDragging(true);
  };

  const removeFile = (index) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    setParsingWarning(null);
    setParsedDataCache(null);
  };


  const handleProceed = async () => {
    if (files.length > 0) {
      setLoading(true);
      try {
        // Dynamically load the parser based on config
        const parser = await getParser(config.general.parser);
        // Parse the file(s) before navigating
        setProgress(null);
        // Multi-part exports (Google Takeout) hand every file to the parser at once.
        const input = config.general.multipleFiles ? files : files[0];
        // Streaming parsers (large wearable exports) report a 0..1 fraction.
        // `parserOptions` carries per-platform parameters from the config (e.g. the time window).
        const parseResult = await parser(input, (fraction) => {
          const pct = Math.min(100, Math.floor(fraction * 100));
          setProgress((prev) => (prev === pct ? prev : pct));
        }, config.general.parserOptions);
        const parsed = parseResult.data;
        const parsingErrors = parseResult.parsingErrors;
        
        // Dynamically load the validator based on config
        const validator = await getValidator(config.general.validator);
        const validationResult = await validator(parseResult);

        if (!validationResult.valid) {
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
          parsingErrors: parsingErrors,
          parserMetadata: parseResult.metadata || null
        });
        
        // Navigate to filter page only after parsing is complete
        navigate('/filter');
      } catch (error) {
        console.error('Error parsing file:', error);
        alert('Error parsing file: ' + error.message);
      } finally {
        setLoading(false);
        setProgress(null);
      }
    }
  };



  const handleTryAgain = () => {
    setParsingWarning(null);
    setParsedDataCache(null);
    setFiles([]);
    setIgnoredCount(0);
  };

  const upload = config.page.upload;
  const extensionList = config.general.fileExtensions.join(', ');
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

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
          <div
            data-testid="dropzone"
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragging ? '#1976d2' : '#9e9e9e'}`,
              background: dragging ? 'rgba(25, 118, 210, 0.08)' : 'transparent',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <div className="d-flex flex-wrap align-items-center" style={{ gap: 8 }}>
              <Button component="label" variant="contained">
                {upload.uploadButton}
                <input
                  type="file"
                  hidden
                  data-testid="file-input"
                  onChange={handleFileChange}
                  multiple={multiple}
                  accept={config.general.fileExtensions.join(',')}
                />
              </Button>
              {multiple && (
                <Button component="label" variant="outlined">
                  {upload.folderButton || 'Select a folder'}
                  <input
                    type="file"
                    hidden
                    data-testid="folder-input"
                    onChange={handleFileChange}
                    multiple
                    webkitdirectory=""
                  />
                </Button>
              )}
            </div>
            <p className="mt-2 mb-0 text-muted">
              {upload.dropHint || (multiple
                ? `Or drag and drop ${extensionList} files, or a folder, here.`
                : 'Or drag and drop the file here.')}
            </p>
          </div>
          {files.length === 1 && !parsingWarning && (
            <div className="alert alert-info mt-3">
              {upload.selectedFile} {files[0].name}
            </div>
          )}
          {files.length > 1 && !parsingWarning && (
            <div className="alert alert-info mt-3">
              <div className="d-flex justify-content-between align-items-center">
                <strong>
                  {upload.selectedFile} {files.length} files ({formatSize(totalBytes)})
                </strong>
                <Button size="small" onClick={() => setFiles([])} disabled={loading}>
                  {upload.clearAll || 'Clear all'}
                </Button>
              </div>
              <ul className="mb-0 mt-2" data-testid="selected-files">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                    {file.name} ({formatSize(file.size)}){' '}
                    <Button
                      size="small"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                      disabled={loading}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ignoredCount > 0 && (
            <Alert severity="info" sx={{ mt: 2 }} data-testid="ignored-note">
              {ignoredCount} {ignoredCount === 1 ? 'file was' : 'files were'} ignored because only {extensionList} files
              are used. {multiple && 'Files you have already extracted are not used; choose the .zip files themselves.'}
            </Alert>
          )}
          {loading && (
            <div className="alert alert-warning mt-3">
              <div className="d-flex align-items-center">
                <CircularProgress size={20} className="me-2" />
                <span>
                  {config.page.upload.processing}
                  {progress !== null && ` (${progress}%)`}
                </span>
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
              disabled={files.length === 0 || loading || parsingWarning}
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
