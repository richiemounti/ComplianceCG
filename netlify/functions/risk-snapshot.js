const { captureRiskHistory } = require('./notion')
exports.handler = async () => {
  await captureRiskHistory()
  return { statusCode: 200 }
}
