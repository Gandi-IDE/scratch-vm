const statements = [
    'control_get_counter',
    'control_incr_counter',
    'control_clear_counter',
    'motion_glideto',
    'motion_glidesecstoxy',
    'motion_goto',
    'sound_play',
    'sound_playuntildone',
    'sound_stopallsounds',
    'sound_seteffectto',
    'sound_changeeffectby',
    'sound_cleareffects',
    'sound_setvolumeto',
    'sensing_askandwait',
    'sound_seteffectto',
    'sound_changeeffectby',
    'sound_changevolumeby',
    'looks_nextcostume',
    'looks_nextbackdrop',
    'looks_say',
    'looks_sayforsecs',
    'looks_think',
    'looks_changeeffectby',
    'looks_seteffectto',
    'looks_thinkforsecs',
    'sensing_setdragmode',
    'motion_pointtowards'
];

const inputs = [
    'sound_volume',
    'sensing_of',
    'sensing_distanceto',
    'sensing_current',
    'sensing_dayssince2000',
    'sensing_loudness',
    'sensing_loud',
    'sensing_answer'
];

module.exports = {
    statements,
    inputs
};
