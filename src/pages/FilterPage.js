import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataGrid } from '@mui/x-data-grid';
import { Box } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useConfig } from '../ConfigContext';

const FilterPage = ({ parsedData }) => {
  const config = useConfig();
  const [data, setData] = useState({});
  const [selectionModel, setSelectionModel] = useState({});
  const [deletedRowCounts, setDeletedRowCounts] = useState({});
  const [parsingErrors, setParsingErrors] = useState({ sheetsNotFound: [], tablesNotParsed: [] });
  const navigate = useNavigate();

  // Helper function to calculate dynamic page size for DataGrid
  const getDynamicPageSize = (rowCount) => {
    // For small datasets, show all rows without pagination
    // For larger datasets, use pagination with pageSize of 5
    return rowCount <= 10 ? rowCount : 5;
  };

  // Helper function to create responsive column configuration
  const createResponsiveColumns = (dataKeys) => {
    const minWidth = 120;
    const maxWidth = 300;
    
    return dataKeys.map((key) => {
      const cleanHeaderName = key.replace(/"/g, '');
      
      // Determine flex value based on column type
      let flexValue = 1;
      
      // Wider columns for certain field types
      if (cleanHeaderName.toLowerCase().includes('name') || 
          cleanHeaderName.toLowerCase().includes('description') ||
          cleanHeaderName.toLowerCase().includes('title')) {
        flexValue = 1.5;
      }
      // Narrower columns for IDs, counts, etc.
      else if (cleanHeaderName.toLowerCase().includes('id') || 
               cleanHeaderName.toLowerCase().includes('count') ||
               cleanHeaderName.toLowerCase().includes('number')) {
        flexValue = 0.8;
      }
      
      return {
        field: key,
        headerName: cleanHeaderName,
        flex: flexValue, // Use flex for responsive width
        minWidth: minWidth,
        maxWidth: maxWidth,
        resizable: true,
      };
    });
  };

  useEffect(() => {
    if (parsedData && parsedData.data) {
      // Data is already parsed, just set it
      setData(parsedData.data);
      setSelectionModel(parsedData.selectionModel);
      setParsingErrors(parsedData.parsingErrors || { sheetsNotFound: [], tablesNotParsed: [] });
      
      // Initialize deleted row counts for each table
      const initialDeletedCounts = {};
      Object.keys(parsedData.data).forEach(sheetName => {
        initialDeletedCounts[sheetName] = 0;
      });
      setDeletedRowCounts(initialDeletedCounts);
    } else {
      // No parsed data, redirect to upload
      navigate('/upload');
    }
  }, [parsedData, navigate]);

  const handleProceed = () => {
    // Prepare the data that hasn't been deleted by the user
    const donationData = {};
    for (const sheetName in data) {
      // Get all remaining data (not just selected, but all data that hasn't been deleted)
      donationData[sheetName] = data[sheetName].map(row => {
        // Remove internal id and selected fields from the exported data
        const { id, selected, ...cleanRow } = row;
        return cleanRow;
      });
    }
    
    // Generate 16-digit submission ID
    const submissionId = Math.floor(Math.random() * 9000000000000000) + 1000000000000000;
    console.log('Generated Submission ID:', submissionId);
    
    // Create the complete donation package
    const donationPackage = {
      submissionId: submissionId.toString(),
      timestamp: new Date().toISOString(),
      data: donationData,
      deletedRowCounts: deletedRowCounts,
      parsingErrors: parsingErrors,
      metadata: {
        totalTables: Object.keys(data).length,
        totalRemainingRows: Object.values(data).reduce((total, tableData) => total + tableData.length, 0),
        totalDeletedRows: Object.values(deletedRowCounts).reduce((total, count) => total + count, 0),
        totalSheetsNotFound: parsingErrors.sheetsNotFound.length,
        totalTablesNotParsed: parsingErrors.tablesNotParsed.length
      }
    };
    
    console.log('Donation Package:', donationPackage);
    
    // Create and download the JSON file
    const jsonString = JSON.stringify(donationPackage, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `playstation-data-donation-${submissionId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Navigate to thank you page after download
    navigate('/thank-you', { state: { donated: true, submissionId: submissionId.toString() } });
  };

  const handleDecline = () => {
    console.log('User declined to donate data');
    navigate('/thank-you', { state: { donated: false } });
  };

  // Delete selected rows for a given sheet
  const handleDeleteRows = (sheetName) => {
    const selectedIds = selectionModel[sheetName] || [];
    const deletedCount = selectedIds.length;
    console.log(`Deleting rows in ${sheetName}. Selected IDs:`, selectedIds);
    console.log(`Deleting ${deletedCount} rows from ${sheetName}`);
    
    setData(prevData => ({
      ...prevData,
      [sheetName]: prevData[sheetName].filter((row) => !selectedIds.includes(row.id))
    }));

    // Update deleted row count for this table
    setDeletedRowCounts(prevCounts => ({
      ...prevCounts,
      [sheetName]: (prevCounts[sheetName] || 0) + deletedCount
    }));

    // Clear the selection for that sheet after deletion
    setSelectionModel(prev => ({
      ...prev,
      [sheetName]: []
    }));
  };

  // Add more robust config checking
  if (!config || !config.page || !config.page.filter) {
    return <div>Loading...</div>;
  }

  // Show loading state while data is being set
  if (Object.keys(data).length === 0) {
    return (
      <div className="container mt-5">
        <div className="card">
          <div className="card-body text-center">
            <div className="spinner-border" role="status">
              <span className="sr-only">{config.page.filter.loading}</span>
            </div>
            <p className="mt-3">{config.page.filter.loadingData}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid mt-5">
      <div className="card">
        <div className="card-header">
                          <h2>{config.page.filter.dataOverview}</h2>
        </div>
        <div className="card-body">
          <p>{config.page.filter.intro}</p>
          {Object.keys(data).map((sheetName) => {
            if (data[sheetName].length === 0) {
              return null;
            }
            const dataKeys = Object.keys(data[sheetName][0]).filter(key => key !== 'id' && key !== 'selected');
            const columns = createResponsiveColumns(dataKeys);

            const dynamicPageSize = getDynamicPageSize(data[sheetName].length);

            return (
              <Box key={sheetName} sx={{ width: '100%', mb: 4 }}>
                <h3 style={{
                  paddingTop: '4px',
                  paddingBottom: '4px',
                  borderTopWidth: '2px',
                  borderBottomWidth: '2px',
                  marginTop: '8px',
                  marginBottom: '16px'
                }}>{sheetName.replace(/"/g, '')}</h3>
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  minHeight: '200px', 
                  maxHeight: '600px', 
                  width: '100%', 
                  mb: 2 
                }}>
                  <DataGrid
                    rows={data[sheetName]}
                    columns={columns}
                    pageSize={dynamicPageSize}
                    rowsPerPageOptions={[dynamicPageSize]}
                    checkboxSelection
                    autosizeOnMount
                    autosizeOptions={{
                      includeHeaders: true,
                      includeOutliers: true,
                      outliersFactor: 1,
                      expand: true
                    }}
                    sx={{ flexGrow: 1 }}
                    onRowSelectionModelChange={(newSelectionModel) => {
                      console.log('onSelectionModelChange triggered!', {
                        sheetName,
                        newSelectionModel,
                        currentState: selectionModel[sheetName]
                      });
                      
                      const previousSelection = selectionModel[sheetName] || [];
                      // Extract IDs from MUI v8 selection format
                      const currentSelection = newSelectionModel?.ids ? Array.from(newSelectionModel.ids) : [];
                      
                      // Log overall selection change
                      console.log(`Selection changed in ${sheetName}:`, newSelectionModel);
                      
                      // Log individual row selections/deselections
                      const added = currentSelection.filter(id => !previousSelection.includes(id));
                      const removed = previousSelection.filter(id => !currentSelection.includes(id));
                      
                      added.forEach(rowId => {
                        console.log(`Row selected - Table: ${sheetName}, Row ID: ${rowId}`);
                      });
                      
                      removed.forEach(rowId => {
                        console.log(`Row deselected - Table: ${sheetName}, Row ID: ${rowId}`);
                      });
                      
                      setSelectionModel(prev => ({...prev, [sheetName]: currentSelection}));
                    }}
                  />
                </Box>

                {/* Show delete button only when there is at least one selected row */}
                {selectionModel[sheetName] && selectionModel[sheetName].length > 0 && (
                  <button
                    className="btn btn-danger"
                    style={{ 
                      marginBottom: '24px',
                      marginTop: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onClick={() => handleDeleteRows(sheetName)}
                  >
                    <DeleteIcon fontSize="small" />
                    {config.page.filter.deleteSelectedRows}
                  </button>
                )}
              </Box>
            );
          })}
          <p className="mt-4 mb-3"><strong>{config.page.filter.donationPrompt}</strong></p>
          <div className="d-flex mt-3" style={{ gap: '2rem' }}>
            <button className="btn btn-success" onClick={handleProceed}>
              {config.page.filter.donateButton}
            </button>
            <button className="btn btn-secondary" onClick={handleDecline}>
              {config.page.filter.declineButton}
            </button>
          </div>
          <p className="mt-3 text-muted">
            <strong>{config.page.filter.note.split(':')[0]}:</strong> {config.page.filter.note.split(':')[1]}
          </p>
        </div>
      </div>
    </div>
  );
};

export default FilterPage;
