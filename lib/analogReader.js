"use strict";

var fs = require("fs");

var sysFsPath = "/sys/class/saradc/ch";

function santizeNumber(number) {
  return parseInt(number.toString().replace(/\D/g, ''), 10);
}

function noop() {}

function readAnalogChannel(channel, callback) {
  channel = santizeNumber(channel);
  fs.readFile(sysFsPath + "channel", function(err, data) {
    if (err) {
      return (callback || noop)(err);
    }
    (callback || noop)(null, parseInt(data, 10));
  });
}


module.exports = {
  readAnalogChannel: readAnalogChannel,
};
