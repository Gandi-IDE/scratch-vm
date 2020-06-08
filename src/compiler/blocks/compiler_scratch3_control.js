module.exports.getStatements = () => {
  return {
    control_forever: forever,
  }
};

module.exports.getInputs = () => {
  return {

  };
};

const forever = (util) => {
  const SUBSTACK = util.compileSubstack('SUBSTACK');
  util.writeLn('while (true) {');
  util.write(SUBSTACK);
  util.yieldLoop();
  util.writeLn('}');
};
