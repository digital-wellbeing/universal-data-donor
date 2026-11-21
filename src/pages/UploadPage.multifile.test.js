import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UploadPage from './UploadPage';
import { ConfigContext } from '../ConfigContext';
import { getParser } from '../utils/parserFactory';
import { getValidator } from '../utils/validatorFactory';

jest.mock('../utils/parserFactory');
jest.mock('../utils/validatorFactory');

const baseConfig = (general = {}) => ({
  general: { parser: 'p', validator: 'v', fileExtensions: ['.zip'], ...general },
  page: {
    upload: {
      title: 'Upload', intro: 'intro', uploadButton: 'Pick files', selectedFile: 'Selected: ', processing: 'Processing',
      noDataFound: 'none', incorrectFile: 'bad', possibleIssues: 'issues', issuePoints: [], unparseableSheets: 'x',
      checkFile: 'check', tryAgainButton: 'Again', note: 'Note: details', processingButton: '...', proceedButton: 'Proceed',
    },
  },
});

const renderPage = (config, setParsedData = jest.fn()) => {
  render(
    <ConfigContext.Provider value={config}>
      <MemoryRouter><UploadPage setParsedData={setParsedData} /></MemoryRouter>
    </ConfigContext.Provider>,
  );
  return { setParsedData, input: screen.getByLabelText(/pick files/i) };
};

const zipFile = (name) => new File(['x'], name, { type: 'application/zip' });
const parseOk = { data: { T: [{ a: 1 }] }, parsingErrors: { sheetsNotFound: [], tablesNotParsed: [] } };

beforeEach(() => {
  getValidator.mockResolvedValue(async () => ({ valid: true }));
});

describe('UploadPage multi-file support', () => {
  test('a multi-file platform hands every selected file and the parser options to the parser', async () => {
    const parser = jest.fn().mockResolvedValue({ ...parseOk, metadata: { window: { months: 6, totalDropped: 3 } } });
    getParser.mockResolvedValue(parser);
    const options = { windowMonths: 6, youtubeSessionGapMinutes: 30 };
    const { input, setParsedData } = renderPage(baseConfig({ multipleFiles: true, parserOptions: options }));

    expect(input.multiple).toBe(true);
    fireEvent.change(input, { target: { files: [zipFile('a.zip'), zipFile('b.zip')] } });
    expect(screen.getByText(/Selected: 2 files/)).toBeInTheDocument();
    expect(screen.getByText(/a\.zip/)).toBeInTheDocument();
    expect(screen.getByText(/b\.zip/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proceed-button'));

    await waitFor(() => expect(setParsedData).toHaveBeenCalled());
    const [input0, , options0] = parser.mock.calls[0];
    expect(input0.map((f) => f.name)).toEqual(['a.zip', 'b.zip']);
    expect(options0).toEqual(options);
    expect(setParsedData.mock.calls[0][0].parserMetadata).toEqual({ window: { months: 6, totalDropped: 3 } });
  });

  test('a single-file platform still passes one File, not an array', async () => {
    const parser = jest.fn().mockResolvedValue(parseOk);
    getParser.mockResolvedValue(parser);
    const { input, setParsedData } = renderPage(baseConfig());

    expect(input.multiple).toBe(false);
    fireEvent.change(input, { target: { files: [zipFile('only.zip')] } });
    fireEvent.click(screen.getByTestId('proceed-button'));

    await waitFor(() => expect(setParsedData).toHaveBeenCalled());
    expect(parser.mock.calls[0][0]).toBeInstanceOf(File);
    expect(parser.mock.calls[0][0].name).toBe('only.zip');
    expect(setParsedData.mock.calls[0][0].parserMetadata).toBeNull();
  });

  test('proceed stays disabled until a file is chosen', () => {
    getParser.mockResolvedValue(jest.fn());
    renderPage(baseConfig({ multipleFiles: true }));
    expect(screen.getByTestId('proceed-button')).toBeDisabled();
  });
});
