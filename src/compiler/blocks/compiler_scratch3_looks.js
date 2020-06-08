module.exports.getStatements = () => {
  return {
    looks_changeeffectby: changeEffect,
  }
};

module.exports.getInputs = () => {
  return {

  };
};

const changeEffect = (util) => {
  const CHANGE = util.getInput('CHANGE');
  util.writeLn(`target.setEffect("color", target.effects.color + ${CHANGE});`);
};
