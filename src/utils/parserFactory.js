export const getParser = async (parserName) => {
  if (!parserName) {
    throw new Error('Parser name not provided');
  }
  const module = await import(`../parsers/${parserName}.js`);
  return module.default;
};

