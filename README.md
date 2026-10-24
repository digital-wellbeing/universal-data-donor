# Universal Data Donor

> ⚠️ **BETA VERSION**: This application is currently in beta. Users may encounter bugs or unexpected behavior. Please report any issues to the development team.

A React application that allows users to donate their gaming platform data for academic research while maintaining full control over what data is shared. Currently supports:
- **PlayStation** data exports (.xlsx)
- **Google Play Games Services** data from Google Takeout (.zip)
- **ActivityWatch** exports
- Wearables and social media — see [Wearable & social-media exports](#wearable--social-media-exports)

## 🚀 Live Demo

Try the application here:
- **PlayStation**: [https://digital-wellbeing.github.io/universal-data-donor/?platform=playstation](https://digital-wellbeing.github.io/universal-data-donor/?platform=playstation)
- **Google Play Games**: [https://digital-wellbeing.github.io/universal-data-donor/?platform=android](https://digital-wellbeing.github.io/universal-data-donor/?platform=android)

> **Note**: Use the `?platform=` URL parameter to select the platform. Defaults to PlayStation if no parameter is provided.

## Features

### Multi-Platform Support
- **PlayStation**: Upload PlayStation data files (.xlsx format)
- **Google Play Games**: Upload Google Takeout files (.zip format) containing Google Play Games Services data
- Platform selection via URL parameter (`?platform=playstation` or `?platform=android`)
- Automatic format detection for Google Play data (JSON or HTML)

### Wearable & social-media exports

All parsing happens in the browser. Wearable parsers emit daily summaries
(plus per-night sleep and per-session exercise rows); none emit raw sample
streams, GPS, profiles, device identifiers or free text.

| `?platform=` | Upload | Tables |
|---|---|---|
| `garmin` | Garmin "Export Your Data" .zip | Daily Wellness, VO2max, Sleep, Activities, Devices |
| `googlefit` | Google Takeout "Fit" .zip | Daily metrics, Sessions |
| `applehealth` | iPhone Health → Export All Health Data: `export.zip` or `export.xml` (multi-GB, streamed) | Daily Activity, Sleep, Workouts |
| `healthconnect` | Android Health Connect → Export data: `Health Connect.zip` (SQLite, read by a pure-JS reader) | Daily Activity, Sleep, Exercise |
| `fitbit` | Google Takeout "Fitbit" / "Google Health" .zip (legacy JSON and 2024–2026 CSV layouts) | Daily Activity, Sleep, Exercise |
| `samsunghealth` | Samsung Health → Download personal data, folder compressed to .zip | Daily Activity, Sleep, Exercise |
| `instagram` | Instagram "Download your information" (JSON format) .zip | Daily Activity (counts only), Activity Totals, Topics |

Cross-cutting rules:
- **Overlapping sources are never summed** (phone + watch + mirrored apps all
  write steps): each platform uses its own reconciled stream where one exists
  (Fitbit Global Export, Samsung "Combined" device) and otherwise the largest
  single-source daily total.
- **Local days** come from each record's own UTC offset (Apple, Health
  Connect, Samsung) or from offsets observed in sleep/exercise rows (Fitbit,
  falling back to the donor's browser time zone). Sleep nights run 18:00→18:00
  and are dated by the wake-up day.
- **Instagram** is reduced to per-day counts: no usernames, links, message or
  comment text, captions, media or search terms leave the parser.
- Large uploads report progress; the streaming zip reader (`src/utils/zipReader.js`)
  supports ZIP64 and keeps memory flat (a 700 MB `export.xml` parses in ~5 s
  with a ~60 MB heap).
- Test fixtures are synthetic (`scripts/fixtures/` regenerates the binary ones).

### Data Upload & Processing
- Automatic parsing and extraction of relevant data tables
- Support for multiple data categories per platform
- **PlayStation**: Account Device, Gameplay Online, Transaction Details, etc.
- **Google Play Games**: Daily playtime data (package name, duration, sessions)
- **NEW**: Intelligent failsafe detection for incorrect or corrupted files
- Warning system when uploaded files lack expected platform data

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

## How to Obtain Your Data

### PlayStation Data
1. Request your PlayStation data export from Sony
2. Download the .xlsx file when ready
3. Use the PlayStation URL: `?platform=playstation`

### Google Play Games Data
1. Go to [Google Takeout](https://takeout.google.com/)
2. **Deselect all** products (click "Deselect all")
3. Scroll down and select **only** "Google Play Games Services"
4. Click "Next step" at the bottom
5. Choose:
   - **File type**: Either `.zip` (recommended) or `.tgz`
   - **Delivery method**: "Send download link via email" or "Add to Drive"
6. Click "Create export"
7. Wait for the email notification (usually within minutes to hours)
8. Download the ZIP file
9. Use the Google Play Games URL: `?platform=android`

> **Note**: The Google Play Games data may be in either JSON or HTML format. The parser automatically detects and handles both formats.

## Application Flow

1. **Consent Page**: Users review and agree to data donation terms
2. **Upload Page**: Users upload their data file
   - **PlayStation**: .xlsx file
   - **Google Play Games**: .zip file from Google Takeout
   - **File Validation**: Automatic detection of incorrect or corrupted files
   - **Warning System**: Users are alerted if the file lacks expected platform data
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
- **Data Processing**:
  - ExcelJS for PlayStation (.xlsx) parsing
  - JSZip for Google Takeout (.zip) extraction
  - DOMParser for HTML format parsing
- **Data Display**: MUI DataGrid for interactive tables
- **Build Tool**: Create React App
- **Architecture**: Factory pattern for dynamic parser/validator loading

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

## Deployment (containers)

The platform runs as two containers defined in `docker-compose.yml`:

| Container | What | Listens on |
|---|---|---|
| `datadonation-web` | the built SPA, served by an unprivileged Caddy (multi-stage `Dockerfile`) | `127.0.0.1:8084` |
| `datadonation-api` | the Flask submission API (`server/`) | `127.0.0.1:8083` |

Both run with a read-only root filesystem, `cap_drop: ALL` and `no-new-privileges`,
and neither runs as root. The host's Caddy is the edge: it proxies `/datadonation/submit` to the API
and `/datadonation/*` to the web container, and adds the security headers and IP
allow-list from `deploy/harden-host.sh`.

**Run locally:**

```bash
cp server/datadonation-api.env.example server/datadonation-api.env   # once; TEST Turnstile secret
DATA_DIR=$PWD/.data docker compose up -d --build
# web: http://127.0.0.1:8084  (paths are root-relative; the app expects /datadonation in front)
```

**Deploy to the VPS:** commit, then from your machine:

```bash
deploy/sync-to-host.sh            # default ssh host: iema-ts
```

This ships `HEAD` (via `git archive`) to `~/datadonation` on the host and runs
`deploy-datadonation.sh` there. That script builds both images, swaps the
containers, and checks that they're healthy. It needs no sudo. Root is only needed the first time,
to create the data dir and point Caddy at the containers; the script prints the
`sudo` command when that's required. The host keeps its secrets in
`~/datadonation/server/datadonation-api.env`, which the sync never touches.

## Development Notes

### Recent Updates
- **File Validation Failsafe**: Added intelligent detection for incorrect or corrupted PlayStation data files
- **Platform-Specific Validators**: Configurable validators ensure uploaded files contain usable data
- **Data Donation Enhancement**: Added comprehensive JSON export functionality
- **Privacy Controls**: Implemented automatic removal of internal application fields
- **Deletion Tracking**: Added per-table deleted row count tracking
- **Parsing Error Tracking**: Added tracking of sheets that couldn't be found or parsed
- **Metadata Generation**: Included donation statistics and timestamps

### Key Components
- `FilterPage.js`: Main data review interface with donation functionality
- `UploadPage.js`: File upload and processing with platform-agnostic design
- `ConfigContext.js`: Dynamic configuration loading based on URL parameter
- **Parsers**:
  - `playstationParser.js`: Excel file parsing logic
  - `androidParser.js`: Google Takeout ZIP parsing (JSON/HTML auto-detection)
- **Validators**:
  - `playstationValidator.js`: PlayStation data validation
  - `androidValidator.js`: Google Play Games data validation
- **Factories**:
  - `parserFactory.js`: Dynamic parser loading
  - `validatorFactory.js`: Dynamic validator loading
- `ConsentPage.js`: User consent and terms
- `ThankYouPage.js`: Donation confirmation

### Adding New Platforms
To add support for a new platform:
1. Create a new parser in `src/parsers/[platform]Parser.js`
2. Create a new validator in `src/validators/[platform]Validator.js`
3. Register both in `parserFactory.js` and `validatorFactory.js`
4. Create a configuration file in `public/config-[platform].json`
5. Add the platform name to the `validPlatforms` array in `ConfigContext.js`
6. Add a card (and its id in `ENABLED_PLATFORM_IDS`) in `PlatformSelector.js`
7. Add the id to `ALLOWED_PLATFORMS` in `server/app.py`, or submissions are rejected with `unknown_platform`
8. Test with sample data files (parsers receive `(file, onProgress)`; call `onProgress(0..1)` for long parses)

## Data Privacy & Security

### Privacy Features
- **Local Processing**: All data processing happens locally in the browser
- **User Control**: Users can delete specific rows before donation
- **Transparent Export**: Clear visibility into what data is being donated
- **Clean Data**: Internal application fields are automatically removed

### Supported Data Categories

#### PlayStation
- Account Device information
- Gameplay Online sessions
- Friend count data
- PS Stars campaigns and collectibles
- Transaction details
- Subscription information
- PS VR usage data

#### Google Play Games Services
- Daily playtime data
  - Date of play
  - Package name (app identifier)
  - Duration (formatted as hours/minutes/seconds)
  - First session start time
  - Last session end time
  - Number of sessions

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
├── parsers/            # Platform-specific parsers
│   ├── playstationParser.js
│   └── androidParser.js
├── validators/         # Platform-specific validators
│   ├── playstationValidator.js
│   └── androidValidator.js
├── utils/              # Factory utilities
│   ├── parserFactory.js
│   └── validatorFactory.js
├── ConfigContext.js    # Configuration management
└── App.js              # Main application component

public/
├── config-playstation.json  # PlayStation configuration
├── config-android.json      # Google Play Games configuration
├── playstation-svgrepo-com.svg
└── android-logo.svg
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
