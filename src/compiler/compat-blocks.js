/**
 * @fileoverview List of blocks to be supported in the compiler compatibility layer.
 */

// Please keep these lists alphabetical.

const stacked = [
    'control_clear_counter',
    'control_get_counter',
    'control_incr_counter',
    'looks_changeeffectby',
    'looks_say',
    'looks_sayforsecs',
    'looks_seteffectto',
    'looks_switchbackdroptoandwait',
    'looks_think',
    'looks_thinkforsecs',
    'motion_glidesecstoxy',
    'motion_glideto',
    'motion_goto',
    'motion_pointtowards',
    'music_changeTempo',
    'music_midiSetInstrument',
    'music_playDrumForBeats',
    'music_playNoteForBeats',
    'music_restForBeats',
    'music_setInstrument',
    'music_setTempo',
    'sensing_askandwait',
    'sensing_setdragmode',
    'sound_changeeffectby',
    'sound_changevolumeby',
    'sound_cleareffects',
    'sound_play',
    'sound_playuntildone',
    'sound_seteffectto',
    'sound_setvolumeto',
    'sound_stopallsounds',
    'text2speech_setLanguage',
    'text2speech_setVoice',
    'text2speech_speakAndWait',
    'videoSensing_setVideoTransparency',
    'videoSensing_videoToggle'
];

const inputs = [
    'control_get_counter',
    'music_getTempo',
    'sensing_loud',
    'sensing_loudness',
    'sound_volume',
    'translate_getTranslate',
    'translate_getViewerLanguage',
    'videoSensing_videoOn'
];

module.exports = {
    stacked,
    inputs
};
