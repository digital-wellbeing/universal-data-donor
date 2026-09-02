const parserImporters = {
  playstationParser: () => import('../parsers/playstationParser.js'),
  androidParser: () => import('../parsers/androidParser.js'),
  activitywatchParser: () => import('../parsers/activitywatchParser.js'),
  googlefitParser: () => import('../parsers/googlefitParser.js'),
  garminParser: () => import('../parsers/garminParser.js'),
};

export const getParser = async (parserName) => {
  const importer = parserImporters[parserName];
  if (!importer) {
    throw new Error(`Unknown parser: ${parserName}`);
  }
  const module = await importer();
  return module.default;
};

