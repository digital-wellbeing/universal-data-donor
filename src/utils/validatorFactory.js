const validatorImporters = {
  playstationValidator: () => import('../validators/playstationValidator.js'),
  androidValidator: () => import('../validators/androidValidator.js'),
  activitywatchValidator: () => import('../validators/activitywatchValidator.js'),
  googlefitValidator: () => import('../validators/googlefitValidator.js'),
  garminValidator: () => import('../validators/garminValidator.js'),
  appleHealthValidator: () => import('../validators/appleHealthValidator.js'),
  healthConnectValidator: () => import('../validators/healthConnectValidator.js'),
};

export const getValidator = async (validatorName) => {
  const importer = validatorImporters[validatorName];
  if (!importer) {
    throw new Error(`Unknown validator: ${validatorName}`);
  }
  const module = await importer();
  return module.default;
};

