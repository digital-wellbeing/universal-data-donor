# PlayStation Data Donation App

> ⚠️ **BETA VERSION**: This application is currently in beta. Users may encounter bugs or unexpected behavior. Please report any issues to the development team.

A React application that allows users to donate their PlayStation data for academic research while maintaining full control over what data is shared.

## 🚀 Live Demo

Try the application here: **[https://digital-wellbeing.github.io/universal-data-donor/](https://digital-wellbeing.github.io/universal-data-donor/)**

## Features

### Data Upload & Processing
- Upload PlayStation data files (.xlsx format)
- Automatic parsing and extraction of relevant data tables
- Support for multiple data categories (Account Device, Gameplay Online, Transaction Details, etc.)
- **NEW**: Intelligent failsafe detection for incorrect or corrupted files
- Warning system when uploaded files lack expected PlayStation data sheets

### Data Review & Control
- Interactive data tables with filtering capabilities
- Row-by-row deletion control
- Real-time tracking of deleted rows per table
- Responsive design for various screen sizes

### Privacy-First Data Donation
- **NEW**: Comprehensive JSON export when donating data
- Automatic removal of internal application fields
- Complete tracking of user deletions
- Metadata generation for transparency

### Data Export Structure
When users click "Yes, donate", a JSON file is automatically downloaded containing:
```json
{
  "submissionId": "16-digit-unique-id",
  "timestamp": "ISO-8601-timestamp",
  "data": {
    "TableName1": [/* remaining user data */],
    "TableName2": [/* remaining user data */]
  },
  "deletedRowCounts": {
    "TableName1": 5,
    "TableName2": 2
  },
  "parsingErrors": {
    "sheetsNotFound": ["Sheet1", "Sheet2"],
    "tablesNotParsed": [
      {
        "sheetName": "Sheet3",
        "reason": "Could not find expected header row",
        "expectedColumns": ["Column1", "Column2"]
      }
    ]
  },
  "metadata": {
    "totalTables": 2,
    "totalRemainingRows": 150,
    "totalDeletedRows": 7,
    "totalSheetsNotFound": 2,
    "totalTablesNotParsed": 1
  }
}
```

## Application Flow

1. **Consent Page**: Users review and agree to data donation terms
2. **Upload Page**: Users upload their PlayStation data file (.xlsx)
   - **File Validation**: Automatic detection of incorrect or corrupted files
   - **Warning System**: Users are alerted if the file lacks expected PlayStation data
   - **User Choice**: Option to try again or proceed anyway
3. **Filter Page**: Users review data tables and can delete specific rows
4. **Donation Process**: When "Yes, donate" is clicked:
   - All remaining data is collected
   - Deleted row counts are tracked
   - JSON package is created and downloaded
   - User is redirected to thank you page
5. **Thank You Page**: Confirmation with submission ID

## Technical Stack

- **Frontend**: React 19.1.0 with React Router
- **UI Components**: Material-UI (MUI) with Bootstrap
- **Data Processing**: ExcelJS for file parsing
- **Data Display**: MUI DataGrid for interactive tables
- **Build Tool**: Create React App

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes and you may see lint errors in the console.

### `npm test`

Launches the test runner in interactive watch mode.\
Tests cover the core functionality including data parsing and export features.

### `npm run build`

Builds the app for production to the `build` folder.\
The build is optimized and minified for deployment.

## Development Notes

### Recent Updates
- **File Validation Failsafe**: Added intelligent detection for incorrect or corrupted PlayStation data files
- **Data Donation Enhancement**: Added comprehensive JSON export functionality
- **Privacy Controls**: Implemented automatic removal of internal application fields
- **Deletion Tracking**: Added per-table deleted row count tracking
- **Parsing Error Tracking**: Added tracking of sheets that couldn't be found or parsed
- **Metadata Generation**: Included donation statistics and timestamps

### Key Components
- `FilterPage.js`: Main data review interface with donation functionality
- `UploadPage.js`: File upload and processing
- `playstationParser.js`: Excel file parsing logic
- `ConsentPage.js`: User consent and terms
- `ThankYouPage.js`: Donation confirmation

## Data Privacy & Security

### Privacy Features
- **Local Processing**: All data processing happens locally in the browser
- **User Control**: Users can delete specific rows before donation
- **Transparent Export**: Clear visibility into what data is being donated
- **Clean Data**: Internal application fields are automatically removed

### Supported Data Categories
- Account Device information
- Gameplay Online sessions
- Friend count data
- PS Stars campaigns and collectibles
- Transaction details
- Subscription information
- PS VR usage data

### File Validation & Failsafe System
The application includes an intelligent failsafe system that automatically detects potentially incorrect or corrupted PlayStation data files:

#### Detection Criteria
- **No Data Found**: Triggers warning when no PlayStation data sheets contain any actual data
- **Empty File Detection**: Identifies files that may be corrupted, incomplete, or not PlayStation exports
- **Data Validation**: Ensures at least one sheet of interest has recognizable PlayStation data

#### User Experience
When a problematic file is detected, users see:
- **Clear Warning Message**: Explanation of the potential issue
- **Detailed Information**: List of missing or unparseable sheets
- **Action Options**: 
  - "Try Again" - Upload a different file
  - "Proceed Anyway" - Continue with available data
- **Guidance**: Recommendation to contact researchers if needed

#### Expected PlayStation Data Sheets
The system expects to find these sheets in a valid PlayStation data export:
- Account Device
- Gameplay Online
- No of Friends
- PS Now
- Ps Stars Campaigns
- Ps Stars Collectibles
- Ps Stars Enrollments
- Ps Stars Points History
- PS VR
- Subscription
- Transaction Detail

## File Structure

```
src/
├── components/          # Reusable UI components
│   ├── Header.js
│   └── CopyToClipboard.js
├── pages/              # Main application pages
│   ├── ConsentPage.js
│   ├── UploadPage.js
│   ├── FilterPage.js
│   └── ThankYouPage.js
├── parsers/            # Data processing utilities
│   └── playstationParser.js
└── App.js              # Main application component
```

## Contributing

This project is designed for academic research purposes. When contributing:

1. Ensure data privacy is maintained
2. Test with sample data files
3. Verify export functionality works correctly
4. Follow React best practices
5. Update tests for new features

## License

This project is intended for academic research purposes.
