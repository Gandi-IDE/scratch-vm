module.exports.getStatements = () => {
  return {
    
  }
};

module.exports.getInputs = () => {
  return {
    math_number: number,
  };
};

const number = (util) => {
  const NUM = util.getFieldUnsafe('NUM');
  const number = Number(NUM);
  return number;
};