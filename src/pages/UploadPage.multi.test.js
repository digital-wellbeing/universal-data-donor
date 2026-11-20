import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import UploadPage from './UploadPage';
import { getParser } from '../utils/parserFactory';
import { getValidator } from '../utils/validatorFactory';
import { ConfigContext } from '../ConfigContext';

jest.mock('../utils/parserFactory');
jest.mock('../utils/validatorFactory');

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ ...jest.requireActual('react-router-dom'), useNavigate: () => mockNavigate }));

const makeConfig = (multipleFiles) => ({
  general: { parser: 'p', validator: 'v', fileExtensions: ['.zip'], multipleFiles, parserOptions: {} },
  page: { upload: {
    title: 'Upload', intro: 'Intro', uploadButton: 'Upload files', selectedFile: 'Selected:', processing: 'Processing',
    note: 'Note: text', proceedButton: 'Proceed', processingButton: 'Working', tryAgainButton: 'Again',
    noDataFound: 'No data', incorrectFile: 'bad', possibleIssues: 'issues', issuePoints: [], unparseableSheets: 'x', checkFile: 'check',
  } },
});

const zip = (name, size = 100) => new File([new Uint8Array(size)], name, { type: 'application/zip', lastModified: 1 });

const renderPage = (multipleFiles = true) => render(
  <ConfigContext.Provider value={makeConfig(multipleFiles)}>
    <BrowserRouter><UploadPage setParsedData={jest.fn()} /></BrowserRouter>
  </ConfigContext.Provider>,
);

const pick = (testId, files) => fireEvent.change(screen.getByTestId(testId), { target: { files } });
const drop = (files) => fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files, items: [] } });

describe('UploadPage multi-file selection', () => {
  const parser = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    parser.mockResolvedValue({ data: { T: [{ a: 1 }] }, parsingErrors: { sheetsNotFound: [], tablesNotParsed: [] } });
    getParser.mockResolvedValue(parser);
    getValidator.mockResolvedValue(async () => ({ valid: true }));
  });

  it('accepts several files in one pick and hands them all to the parser', async () => {
    renderPage();
    pick('file-input', [zip('a.zip'), zip('b.zip'), zip('c.zip')]);
    expect(screen.getByText(/Selected: 3 files/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proceed-button'));
    await waitFor(() => expect(parser).toHaveBeenCalled());
    expect(parser.mock.calls[0][0].map((f) => f.name)).toEqual(['a.zip', 'b.zip', 'c.zip']);
  });

  it('adds a second pick to the first instead of replacing it, without duplicates', () => {
    renderPage();
    pick('file-input', [zip('a.zip'), zip('b.zip')]);
    pick('file-input', [zip('b.zip'), zip('c.zip')]);
    const list = within(screen.getByTestId('selected-files'));
    expect(list.getAllByRole('listitem').map((li) => li.textContent.split(' (')[0])).toEqual(['a.zip', 'b.zip', 'c.zip']);
  });

  it('accepts files dropped on the page', async () => {
    renderPage();
    drop([zip('a.zip'), zip('b.zip')]);
    expect(await screen.findByText(/Selected: 2 files/)).toBeInTheDocument();
  });

  it('accepts a folder chosen with the folder picker and ignores what is not a .zip', () => {
    renderPage();
    pick('folder-input', [zip('part1.zip'), new File(['x'], 'notes.txt'), zip('part2.zip'), new File(['x'], 'photo.jpg')]);
    expect(screen.getByText(/Selected: 2 files/)).toBeInTheDocument();
    expect(screen.getByTestId('ignored-note')).toHaveTextContent('2 files were ignored');
    expect(screen.getByTestId('ignored-note')).toHaveTextContent('already extracted');
  });

  it('lets a file be removed and everything be cleared', () => {
    renderPage();
    pick('file-input', [zip('a.zip'), zip('b.zip'), zip('c.zip')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.zip' }));
    expect(screen.getByText(/Selected: 2 files/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByText(/files \(/)).not.toBeInTheDocument();
    expect(screen.getByTestId('proceed-button')).toBeDisabled();
  });

  it('keeps the previous selection when only unsupported files are dropped', async () => {
    renderPage();
    pick('file-input', [zip('a.zip')]);
    drop([new File(['x'], 'notes.txt')]);
    expect(await screen.findByTestId('ignored-note')).toHaveTextContent('1 file was ignored');
    expect(screen.getByText(/a\.zip/)).toBeInTheDocument();
  });

  it('single-file platforms keep one file, offer no folder picker, and still take a drop', async () => {
    renderPage(false);
    expect(screen.queryByTestId('folder-input')).not.toBeInTheDocument();
    pick('file-input', [zip('a.zip')]);
    drop([zip('b.zip'), zip('c.zip')]);
    expect(await screen.findByText(/b\.zip/)).toBeInTheDocument();
    expect(screen.queryByText(/a\.zip/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proceed-button'));
    await waitFor(() => expect(parser).toHaveBeenCalled());
    expect(parser.mock.calls[0][0].name).toBe('b.zip');
  });
});
