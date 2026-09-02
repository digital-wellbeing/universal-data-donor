import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataGrid } from '@mui/x-data-grid';
import { Box, TextField, Autocomplete, Button, Stack, Typography, Chip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useConfig } from '../ConfigContext';
import TurnstileWidget from '../components/TurnstileWidget';

// Keys that are internal bookkeeping and must never be shown as columns or
// included in the donated data. `id`/`selected` are added by UploadPage; any
// key starting with "_" is a hidden helper emitted by a parser (e.g. the
// ActivityWatch parser's `_timestamp` / `_app`, which power the filters below).
const isInternalKey = (key) => key === 'id' || key === 'selected' || key.startsWith('_');

// Format an epoch-ms value as a local YYYY-MM-DD string for <input type="date">.
const toDateInput = (ms) => {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const FilterPage = ({ parsedData }) => {
  const config = useConfig();
  const [data, setData] = useState({});
  const [selectionModel, setSelectionModel] = useState({});
  const [deletedRowCounts, setDeletedRowCounts] = useState({});
  const [parsingErrors, setParsingErrors] = useState({ sheetsNotFound: [], tablesNotParsed: [] });

  // Filter state (used by ActivityWatch and any parser that emits `_timestamp` / `_app`).
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [excludedApps, setExcludedApps] = useState([]);

  // Submission / captcha state (server ingestion gated by Cloudflare Turnstile).
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0); // bump to remount widget for a fresh token
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Whether any row carries a `_timestamp` (enables the date-range filter) and
  // the min/max timestamps present, so date pickers + presets stay within range.
  const { hasTimestamps, minTs, maxTs } = useMemo(() => {
    let has = false;
    let min = Infinity;
    let max = -Infinity;
    Object.values(data).forEach((rows) => {
      rows.forEach((row) => {
        if (typeof row._timestamp === 'number') {
          has = true;
          if (row._timestamp < min) min = row._timestamp;
          if (row._timestamp > max) max = row._timestamp;
        }
      });
    });
    return { hasTimestamps: has, minTs: has ? min : null, maxTs: has ? max : null };
  }, [data]);

  // Sorted unique app names present (enables the "exclude apps" filter).
  const appOptions = useMemo(() => {
    const apps = new Set();
    Object.values(data).forEach((rows) => {
      rows.forEach((row) => {
        if (row._app) apps.add(row._app);
      });
    });
    return Array.from(apps).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtersAvailable = hasTimestamps || appOptions.length > 0;
  const filtersActive = Boolean(startDate) || Boolean(endDate) || excludedApps.length > 0;

  // Apply the active filters to a table's rows (non-destructive view).
  const filteredData = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : -Infinity;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity;
    const excluded = new Set(excludedApps);

    const result = {};
    for (const sheetName in data) {
      result[sheetName] = data[sheetName].filter((row) => {
        if (typeof row._timestamp === 'number') {
          if (row._timestamp < startMs || row._timestamp > endMs) return false;
        }
        if (row._app && excluded.has(row._app)) return false;
        return true;
      });
    }
    return result;
  }, [data, startDate, endDate, excludedApps]);

  const totalRows = useMemo(
    () => Object.values(data).reduce((sum, rows) => sum + rows.length, 0),
    [data]
  );
  const visibleRows = useMemo(
    () => Object.values(filteredData).reduce((sum, rows) => sum + rows.length, 0),
    [filteredData]
  );

  const applyPresetDays = (days) => {
    if (maxTs == null) return;
    setEndDate(toDateInput(maxTs));
    setStartDate(toDateInput(maxTs - days * 24 * 60 * 60 * 1000));
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setExcludedApps([]);
  };

  // Server-submission config (a missing site key => download-only, legacy behavior).
  const turnstileSitekey = config?.general?.turnstileSitekey || '';
  const platformId = config?.general?.platformId
    || (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('platform')
      : '') || '';
  const submitUrl = `${process.env.PUBLIC_URL}/submit`;

  const submitErrorMessage = (code, status) => {
    switch (code) {
      case 'captcha_failed':
        return 'The “I’m human” check failed. Please try again.';
      case 'rate_limited':
        return 'Too many submissions from your network right now. Please try again later.';
      case 'invalid_payload':
      case 'invalid_json':
      case 'unknown_platform':
        return 'The server rejected the submission. Please contact the researchers.';
      default:
        return `The submission could not be completed (error ${status || 'network'}). Please try again.`;
    }
  };

  // Assemble the donation package from the filtered (and not-manually-deleted) rows.
  const buildDonationPackage = () => {
    const donationData = {};
    const finalDeletedCounts = { ...deletedRowCounts };
    for (const sheetName in data) {
      const visible = filteredData[sheetName] || [];
      donationData[sheetName] = visible.map((row) => {
        const cleanRow = {};
        for (const key in row) {
          if (!isInternalKey(key)) cleanRow[key] = row[key];
        }
        return cleanRow;
      });
      // Count everything withheld from donation for this table: rows the user
      // manually deleted plus rows removed by the active date/app filters.
      const filteredOut = data[sheetName].length - visible.length;
      finalDeletedCounts[sheetName] = (deletedRowCounts[sheetName] || 0) + filteredOut;
    }

    const submissionId = (Math.floor(Math.random() * 9000000000000000) + 1000000000000000).toString();

    const donationPackage = {
      submissionId,
      timestamp: new Date().toISOString(),
      platform: platformId,
      data: donationData,
      deletedRowCounts: finalDeletedCounts,
      parsingErrors: parsingErrors,
      appliedFilters: {
        startDate: startDate || null,
        endDate: endDate || null,
        excludedApps: excludedApps,
      },
      metadata: {
        totalTables: Object.keys(donationData).length,
        totalRemainingRows: Object.values(donationData).reduce((total, tableData) => total + tableData.length, 0),
        totalDeletedRows: Object.values(finalDeletedCounts).reduce((total, count) => total + count, 0),
        totalSheetsNotFound: parsingErrors.sheetsNotFound.length,
        totalTablesNotParsed: parsingErrors.tablesNotParsed.length
      }
    };
    return { donationPackage, submissionId };
  };

  // Give the participant a local copy of exactly what was donated.
  const downloadLocalCopy = (donationPackage, submissionId) => {
    const platformSlug = (config?.general?.platform || 'data')
      .toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
    const jsonString = JSON.stringify(donationPackage, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${platformSlug}-data-donation-${submissionId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleProceed = async () => {
    if (submitting) return;
    const { donationPackage, submissionId } = buildDonationPackage();

    // When a Turnstile site key is configured, submit to the server. The server
    // re-verifies the token, so a bot POSTing directly is rejected there.
    if (turnstileSitekey) {
      if (!captchaToken) {
        setSubmitError('Please complete the “I’m human” check below before donating.');
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await fetch(submitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: platformId,
            turnstileToken: captchaToken,
            donation: donationPackage,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          setSubmitting(false);
          setCaptchaToken('');
          setCaptchaKey((k) => k + 1); // remount widget for a fresh single-use token
          setSubmitError(submitErrorMessage(json.error, res.status));
          return;
        }
      } catch (e) {
        setSubmitting(false);
        setCaptchaToken('');
        setCaptchaKey((k) => k + 1);
        setSubmitError('Could not reach the server. Please check your connection and try again.');
        return;
      }
    }

    // Keep a local copy for the participant's records, then finish.
    downloadLocalCopy(donationPackage, submissionId);
    navigate('/thank-you', { state: { donated: true, submissionId } });
  };

  const handleDecline = () => {
    console.log('User declined to donate data');
    navigate('/thank-you', { state: { donated: false } });
  };

  // Delete selected rows for a given sheet
  const handleDeleteRows = (sheetName) => {
    const selectedIds = selectionModel[sheetName] || [];
    const deletedCount = selectedIds.length;

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

          {filtersAvailable && (
            <Box sx={{ mb: 4, p: 2, border: '1px solid #dee2e6', borderRadius: 2, backgroundColor: '#f8f9fa' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Filter data before donating</Typography>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} flexWrap="wrap" useFlexGap>
                {hasTimestamps && (
                  <>
                    <TextField
                      label="Start date"
                      type="date"
                      size="small"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ min: minTs != null ? toDateInput(minTs) : undefined, max: endDate || (maxTs != null ? toDateInput(maxTs) : undefined) }}
                    />
                    <TextField
                      label="End date"
                      type="date"
                      size="small"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      inputProps={{ min: startDate || (minTs != null ? toDateInput(minTs) : undefined), max: maxTs != null ? toDateInput(maxTs) : undefined }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="outlined" onClick={() => applyPresetDays(7)}>Last 7 days</Button>
                      <Button size="small" variant="outlined" onClick={() => applyPresetDays(30)}>Last 30 days</Button>
                    </Stack>
                  </>
                )}
                {appOptions.length > 0 && (
                  <Autocomplete
                    multiple
                    size="small"
                    options={appOptions}
                    value={excludedApps}
                    onChange={(e, newValue) => setExcludedApps(newValue)}
                    sx={{ minWidth: 280, flexGrow: 1 }}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip label={option} size="small" {...getTagProps({ index })} key={option} />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={config.page.filter.excludeLabel || 'Exclude apps'}
                        placeholder={config.page.filter.excludePlaceholder || 'Select apps to remove'}
                      />
                    )}
                  />
                )}
                {filtersActive && (
                  <Button size="small" color="secondary" onClick={resetFilters}>Reset filters</Button>
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Donating <strong>{visibleRows.toLocaleString()}</strong> of {totalRows.toLocaleString()} rows
                {filtersActive ? ` (${(totalRows - visibleRows).toLocaleString()} filtered out)` : ''}.
              </Typography>
            </Box>
          )}

          {Object.keys(filteredData).map((sheetName) => {
            const rows = filteredData[sheetName];
            if (!rows || rows.length === 0) {
              return null;
            }
            const dataKeys = Object.keys(rows[0]).filter(key => !isInternalKey(key));
            const columns = createResponsiveColumns(dataKeys);

            const dynamicPageSize = getDynamicPageSize(rows.length);

            return (
              <Box key={sheetName} sx={{ width: '100%', mb: 4 }}>
                <h3 style={{
                  paddingTop: '4px',
                  paddingBottom: '4px',
                  borderTopWidth: '2px',
                  borderBottomWidth: '2px',
                  marginTop: '8px',
                  marginBottom: '16px'
                }}>{sheetName.replace(/"/g, '')} <span style={{ fontSize: '0.7em', color: '#6c757d', fontWeight: 'normal' }}>({rows.length.toLocaleString()} rows)</span></h3>
                <Box sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: '200px',
                  maxHeight: '600px',
                  width: '100%',
                  mb: 2
                }}>
                  <DataGrid
                    rows={rows}
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
                      // Extract IDs from MUI v8 selection format
                      const currentSelection = newSelectionModel?.ids ? Array.from(newSelectionModel.ids) : [];
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
          {turnstileSitekey && (
            <div className="mb-3">
              <TurnstileWidget key={captchaKey} sitekey={turnstileSitekey} onToken={setCaptchaToken} />
            </div>
          )}
          {submitError && (
            <div className="alert alert-danger" role="alert">{submitError}</div>
          )}
          <div className="d-flex mt-3" style={{ gap: '2rem' }}>
            <button
              className="btn btn-success"
              onClick={handleProceed}
              disabled={submitting || (turnstileSitekey && !captchaToken)}
            >
              {submitting ? 'Submitting…' : config.page.filter.donateButton}
            </button>
            <button className="btn btn-secondary" onClick={handleDecline} disabled={submitting}>
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
