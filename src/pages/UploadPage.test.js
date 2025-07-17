import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import UploadPage from './UploadPage';
import { getParser } from '../utils/parserFactory';
import { getValidator } from '../utils/validatorFactory';
import { ConfigContext } from '../ConfigContext';
import config from '../../public/config.json';

// Mock the parser factory to return a mocked parser function
jest.mock('../utils/parserFactory');
jest.mock('../utils/validatorFactory');

// Mock parser function that will be returned by getParser
const mockParser = jest.fn();
const mockValidator = jest.fn();


const mockSetParsedData = jest.fn();
const mockNavigate = jest.fn();

// Mock useNavigate
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const renderUploadPage = () => {
  return render(
    <ConfigContext.Provider value={config}>
      <BrowserRouter>
        <UploadPage setParsedData={mockSetParsedData} />
      </BrowserRouter>
    </ConfigContext.Provider>
  );
};

describe('UploadPage Failsafe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getParser.mockResolvedValue(mockParser);
    getValidator.mockResolvedValue(mockValidator);
  });

  it('should show warning when no sheets contain data', async () => {
    // Mock parsing result with no actual data in any sheet
    const mockParseResult = {
      data: {
        '"Account Device"': [],
        '"Gameplay Online"': [],
        '"No of Friends"': [],
        '"PS Now"': [],
        '"Ps Stars Campaigns"': [],
        '"Ps Stars Collectibles"': [],
        '"Ps Stars Enrollments"': [],
        '"Ps Stars Points History"': [],
        '"PS VR"': [],
        '"Subscription"': [],
        '"Transaction Detail"': []
      },
      parsingErrors: {
        sheetsNotFound: [
          '"PS Now"',
          '"Ps Stars Campaigns"',
          '"Ps Stars Collectibles"',
          '"Ps Stars Enrollments"',
          '"Ps Stars Points History"'
        ],
        tablesNotParsed: [
          {
            sheetName: '"PS VR"',
            reason: 'Could not find expected header row',
            expectedColumns: ['VR Data']
          },
          {
            sheetName: '"Subscription"',
            reason: 'No table structure found',
            expectedColumns: null
          },
          {
            sheetName: '"Transaction Detail"',
            reason: 'Could not find expected header row',
            expectedColumns: ['Transaction Date', 'Game Name']
          }
        ]
      }
    };

    mockParser.mockResolvedValue(mockParseResult);
    mockValidator.mockResolvedValue({ valid: false });

    renderUploadPage();

    // Upload a file
    const fileInput = screen.getByLabelText(/upload file/i);
    const file = new File(['test content'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Click proceed
    const proceedButton = screen.getByTestId('proceed-button');
    fireEvent.click(proceedButton);

    // Wait for parsing to complete and warning to appear
    await waitFor(() => {
      expect(screen.getByText('No PlayStation Data Found')).toBeInTheDocument();
    });

    // Check that warning message is displayed
    expect(screen.getByText(/uploaded file might be incorrect, corrupted, or void of PlayStation data/i)).toBeInTheDocument();
    expect(screen.getByText(/contact the researchers for assistance/i)).toBeInTheDocument();

    // Missing sheets section has been removed

    // Check that unparseable sheets are listed
    expect(screen.getByText('Unparseable sheets:')).toBeInTheDocument();
    expect(screen.getByText('PS VR - Could not find expected header row')).toBeInTheDocument();

    // Check that action button is available
    expect(screen.getByText('Try Again')).toBeInTheDocument();

    // Verify that navigation was not called (user should see warning first)
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should proceed normally when at least one sheet contains data', async () => {
    // Mock parsing result with at least one sheet containing data
    const mockParseResult = {
      data: {
        '"Account Device"': [{ 'Console Id': 'PS5-123', id: 1 }],
        '"Gameplay Online"': [],
        '"No of Friends"': [],
        '"Ps Stars Campaigns"': [],
        '"Ps Stars Collectibles"': [],
        '"Ps Stars Enrollments"': [],
        '"Ps Stars Points History"': [],
        '"PS VR"': [],
        '"Subscription"': [],
        '"Transaction Detail"': []
      },
      parsingErrors: {
        sheetsNotFound: ['"PS Now"'],
        tablesNotParsed: [
          {
            sheetName: '"Transaction Detail"',
            reason: 'Could not find expected header row',
            expectedColumns: ['Transaction Date', 'Game Name']
          }
        ]
      }
    };

    mockParser.mockResolvedValue(mockParseResult);
    mockValidator.mockResolvedValue({ valid: true });

    renderUploadPage();

    // Upload a file
    const fileInput = screen.getByLabelText(/upload file/i);
    const file = new File(['test content'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Click proceed
    const proceedButton = screen.getByTestId('proceed-button');
    fireEvent.click(proceedButton);

    // Wait for parsing to complete and navigation to occur
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/filter');
    });

    // Check that no warning is displayed
    expect(screen.queryByText('No PlayStation Data Found')).not.toBeInTheDocument();
  });

  it('should show warning and only allow trying again when no data is found', async () => {
    // Mock parsing result with no data in any sheet
    const mockParseResult = {
      data: {
        '"Account Device"': [],
        '"Gameplay Online"': [],
        '"No of Friends"': [],
        '"PS Now"': [],
        '"Ps Stars Campaigns"': [],
        '"Ps Stars Collectibles"': [],
        '"Ps Stars Enrollments"': [],
        '"Ps Stars Points History"': [],
        '"PS VR"': [],
        '"Subscription"': [],
        '"Transaction Detail"': []
      },
      parsingErrors: {
        sheetsNotFound: [
          '"PS Now"',
          '"Ps Stars Campaigns"',
          '"Ps Stars Collectibles"',
          '"Ps Stars Enrollments"',
          '"Ps Stars Points History"',
          '"PS VR"',
          '"Subscription"',
          '"Transaction Detail"'
        ],
        tablesNotParsed: []
      }
    };

    mockParser.mockResolvedValue(mockParseResult);
    mockValidator.mockResolvedValue({ valid: false });

    renderUploadPage();

    // Upload a file and trigger warning
    const fileInput = screen.getByLabelText(/upload file/i);
    const file = new File(['test content'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const proceedButton = screen.getByTestId('proceed-button');
    fireEvent.click(proceedButton);

    // Wait for warning to appear
    await waitFor(() => {
      expect(screen.getByText('No PlayStation Data Found')).toBeInTheDocument();
    });

    // Verify that "Proceed Anyway" button is not available
    expect(screen.queryByText('Proceed Anyway')).not.toBeInTheDocument();
    
    // Only "Try Again" should be available
    expect(screen.getByText('Try Again')).toBeInTheDocument();

    // Verify that navigation was not called (user should see warning first)
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

