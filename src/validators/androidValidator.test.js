import validateAndroidData from './androidValidator';

describe('androidValidator', () => {
  it('should validate data with both playtime and game activity', () => {
    const parseResult = {
      data: {
        'Daily Playtime': [
          {
            'Date': 'Sep 30, 2025',
            'Package Name': 'com.example.game',
            'Duration': '30 minutes',
            'First Session Start': 'September 30, 2025 at 10:00:00 AM GMT+1',
            'Last Session End': 'September 30, 2025 at 10:30:00 AM GMT+1',
            'Number of Sessions': 1
          }
        ],
        'Game Activity': [
          {
            'Game Title': 'Test Game',
            'Time First Played': 'July 6, 2015 at 7:13:22 AM UTC',
            'Time Last Played': 'October 16, 2015 at 11:30:27 AM UTC'
          }
        ]
      },
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should validate data with only playtime', () => {
    const parseResult = {
      data: {
        'Daily Playtime': [
          {
            'Date': 'Sep 30, 2025',
            'Package Name': 'com.example.game',
            'Duration': '30 minutes',
            'First Session Start': 'September 30, 2025 at 10:00:00 AM GMT+1',
            'Last Session End': 'September 30, 2025 at 10:30:00 AM GMT+1',
            'Number of Sessions': 1
          }
        ]
      },
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should validate data with only game activity', () => {
    const parseResult = {
      data: {
        'Game Activity': [
          {
            'Game Title': 'Test Game',
            'Time First Played': 'July 6, 2015 at 7:13:22 AM UTC',
            'Time Last Played': 'October 16, 2015 at 11:30:27 AM UTC'
          }
        ]
      },
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should invalidate data with no tables', () => {
    const parseResult = {
      data: {},
      parsingErrors: {
        sheetsNotFound: ['Playtime.json', 'Playtime.html'],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No playtime or game activity data found in the file');
  });

  it('should invalidate data with empty tables', () => {
    const parseResult = {
      data: {
        'Daily Playtime': [],
        'Game Activity': []
      },
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No playtime or game activity data found in the file');
  });

  it('should invalidate when data is null', () => {
    const parseResult = {
      data: null,
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No data found in the file');
  });

  it('should invalidate when data is undefined', () => {
    const parseResult = {
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No data found in the file');
  });

  it('should invalidate when parseResult is null', () => {
    const result = validateAndroidData(null);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No data found in the file');
  });

  it('should invalidate when parseResult is undefined', () => {
    const result = validateAndroidData(undefined);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No data found in the file');
  });

  it('should validate with one table having data even if other is empty', () => {
    const parseResult = {
      data: {
        'Daily Playtime': [],
        'Game Activity': [
          {
            'Game Title': 'Test Game',
            'Time First Played': 'July 6, 2015 at 7:13:22 AM UTC',
            'Time Last Played': 'October 16, 2015 at 11:30:27 AM UTC'
          }
        ]
      },
      parsingErrors: {
        sheetsNotFound: [],
        tablesNotParsed: []
      }
    };

    const result = validateAndroidData(parseResult);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
