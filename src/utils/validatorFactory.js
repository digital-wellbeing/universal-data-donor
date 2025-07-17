const validatorImporters = {
  playstationValidator: () => import('../validators/playstationValidator.js'),
};

export const getValidator = async (validatorName) => {
  const importer = validatorImporters[validatorName];
  if (!importer) {
    throw new Error(`Unknown validator: ${validatorName}`);
  }
  const module = await importer();
  return module.default;
};

