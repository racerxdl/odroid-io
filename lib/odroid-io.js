'use strict';

var BoardIO = require('board-io'),
  i2cBus = require('i2c-bus'),
  mutexify = require('mutexify'),
  Gpio = require('onoff').Gpio,
  fs = require("fs"),
  util = require('util'),
  Led = require('./led'),
  AnalogReader = require('./analogReader');

var DEFAULT_SAMPLING_INTERVAL = 1;

var board = fs.readFileSync("/proc/cpuinfo").toString()
  .split("\n")
  .filter(function(line) {
    return line.indexOf("Hardware") == 0;
  });

if (board.length > 0) {
  board = board[0].split(":")[1].trim();
} else {
  board = 'UNKNOWN';
}

if (board !== 'ODROID-C2'){
  console.log("This board is not an Odroid-C2, problems might occur.");
}

var pinModes = [
  { modes: [0, 1],    gpioNo: 247       , ids: ['P1-0', 'GPIO247']  },    // Wiring PI => 0  | ODROID => 247
  { modes: [0, 1],    gpioNo: 238       , ids: ['P1-1', 'GPIO238']  },    // Wiring PI => 1  | ODROID => 238
  { modes: [0, 1],    gpioNo: 239       , ids: ['P1-2', 'GPIO239']  },    // Wiring PI => 2  | ODROID => 239
  { modes: [0, 1],    gpioNo: 237       , ids: ['P1-3', 'GPIO237']  },    // Wiring PI => 3  | ODROID => 237
  { modes: [0, 1],    gpioNo: 236       , ids: ['P1-4', 'GPIO236']  },    // Wiring PI => 4  | ODROID => 236
  { modes: [0, 1],    gpioNo: 233       , ids: ['P1-5', 'GPIO233']  },    // Wiring PI => 5  | ODROID => 233
  { modes: [0, 1],    gpioNo: 231       , ids: ['P1-6', 'GPIO231']  },    // Wiring PI => 6  | ODROID => 231
  { modes: [0, 1],    gpioNo: 249       , ids: ['P1-7', 'GPIO249']  },    // Wiring PI => 7  | ODROID => 249
  { modes: []                           , ids: []                   },    // Wiring PI => 8  | ODROID => null
  { modes: []                           , ids: []                   },    // Wiring PI => 9  | ODROID => null
  { modes: [0, 1],    gpioNo: 229       , ids: ['P1-10', 'GPIO229'] },    // Wiring PI => 10 | ODROID => 229
  { modes: [0, 1],    gpioNo: 225       , ids: ['P1-11', 'GPIO225'] },    // Wiring PI => 11 | ODROID => 225
  { modes: [0, 1],    gpioNo: 235       , ids: ['P1-12', 'GPIO235'] },    // Wiring PI => 12 | ODROID => 235
  { modes: [0, 1],    gpioNo: 232       , ids: ['P1-13', 'GPIO232'] },    // Wiring PI => 13 | ODROID => 232
  { modes: [0, 1],    gpioNo: 230       , ids: ['P1-14', 'GPIO230'] },    // Wiring PI => 14 | ODROID => 230
  { modes: [2],       analogChannel: 0  , ids: ['P1-15', 'A0']      },    // Wiring PI => 15 | ODROID => A0
  { modes: [2],       analogChannel: 1  , ids: ['P1-16', 'A1']      },    // Wiring PI => 16 | ODROID => A1
  { modes: []                           , ids: []                   },    // Wiring PI => 17 | ODROID => null
  { modes: []                           , ids: []                   },    // Wiring PI => 18 | ODROID => null
  { modes: []                           , ids: []                   },    // Wiring PI => 19 | ODROID => null
  { modes: []                           , ids: []                   },    // Wiring PI => 20 | ODROID => null
  { modes: [0, 1],    gpioNo: 228       , ids: ['P1-21', 'GPIO228'] },    // Wiring PI => 21 | ODROID => 228
  { modes: [0, 1],    gpioNo: 219       , ids: ['P1-22', 'GPIO219'] },    // Wiring PI => 22 | ODROID => 219
  { modes: [0, 1],    gpioNo: 234       , ids: ['P1-23', 'GPIO234'] },    // Wiring PI => 23 | ODROID => 234
  { modes: [0, 1],    gpioNo: 214       , ids: ['P1-24', 'GPIO214'] },    // Wiring PI => 24 | ODROID => 214
  { modes: []                           , ids: []                   },    // Wiring PI => 25 | ODROID => null
  { modes: [0, 1],    gpioNo: 224       , ids: ['P1-26', 'GPIO224'] },    // Wiring PI => 26 | ODROID => 224
  { modes: [0, 1],    gpioNo: 218       , ids: ['P1-27', 'GPIO218'] },    // Wiring PI => 27 | ODROID => 218
];

var modes = Object.freeze({
  INPUT: 0,
  OUTPUT: 1,
  ANALOG: 2,
  PWM: 3,
  SERVO: 4
});

function constrain(value, low, high) {
  return Math.max(Math.min(value, high), low);
}

function OdroidIO(options) {
  var i;

  if (!(this instanceof OdroidIO)) {
    return new OdroidIO(options);
  }

  BoardIO.call(this);

  options = options || {};

  this.name = options.name || 'ODROID-IO';

  this._samplingInterval = typeof(options.samplingInterval) !== 'undefined' ?
    options.samplingInterval : DEFAULT_SAMPLING_INTERVAL;
  this._digitalReports = [];
  this._digitalReportsTimeoutId = 0;
  this._analogReports = [];
  this._analogReportsTimeoutId = 0;
  this._pingReadLock = mutexify();
  this._addressToBus = {};
  this._defaultI2cBus = options.defaultI2cBus || 1;
  this._i2cBuses = {};
  this._pinsById = {};

  pinModes.forEach(function (pin, index) {
    var pinData = {
      index: index,
      supportedModes: pin.modes.slice(0),
      mode: this.MODES.UNKNOWN,
      report: 0,
      analogChannel: typeof pin.analogChannel === 'number' ? pin.analogChannel : 127,
      custom: typeof pin.custom === 'undefined' ? {} : pin.custom
    }

    this._pins[index] = pinData;

    if (Array.isArray(pin.ids)) {
      pin.ids.forEach(function (id) {
        this._pinsById[id] = pinData;
      }.bind(this));
    }

    if (typeof pin.gpioNo === 'number') {
      pinData.gpioNo = pin.gpioNo;
    }

    if (typeof pin.ledPath === 'string') {
      pinData.ledPath = pin.ledPath;
      pinData.isLed = true;
    } else {
      pinData.isLed = false;
    }
  }.bind(this));

  setImmediate(function () {
    this.emit('connect');
    this.emit('ready');
  }.bind(this));
}
util.inherits(OdroidIO, BoardIO);

OdroidIO.prototype.normalize = function(pin) {
  if (typeof pin === 'string') {
    return this._pinsById[pin].index;
  }

  return pin;
};

OdroidIO.prototype.pinMode = function(pin, mode) {
  var pinData = this._pins[this.normalize(pin)];

  if (pinData.mode !== mode) {
    if (pinData.mode !== this.MODES.UNKNOWN) {
      throw new Error('Mode can not be changed');
    }

    if (pinData.supportedModes.indexOf(mode) === -1) {
      throw new Error('Mode ' + mode + ' is not supported');
    }

    if (mode === this.MODES.INPUT) {
      this._pinModeInput(pinData);
    } else if (mode === this.MODES.OUTPUT) {
      if (pinData.isLed) {
        this._pinModeLed(pinData);
      } else {
        this._pinModeOutput(pinData);
      }
    } else if (mode === this.MODES.ANALOG) {
      this._pinModeAnalog(pinData);
    } else if (mode === this.MODES.PWM) {
      this._pinModePwm(pinData);
    } else if (mode === this.MODES.SERVO) {
      this._pinModeServo(pinData);
    } else {
      throw new Error('Mode ' + mode + ' is not supported');
    }

    pinData.mode = mode;
  }

  return this;
};

OdroidIO.prototype.digitalRead = function(pin, handler) {
  var pinIndex = this.normalize(pin),
    pinData = this._pins[pinIndex],
    event = 'digital-read-' + pinIndex;

  if (pinData.mode !== this.MODES.INPUT) {
    this.pinMode(pin, this.MODES.INPUT);
  }

  pinData.report = 1;

  this._digitalReports[pinIndex] = {
    pinData: pinData,
    event: event
  }

  this.on(event, handler);

  if (!this._digitalReportsTimeoutId) {
    this._digitalReportsTimeoutId = setTimeout(
      this._digitalReportsTick.bind(this),
      this._samplingInterval
    );
  }

  return this;
};

OdroidIO.prototype.setSamplingInterval = function(ms) {
  this._samplingInterval = Math.min(Math.max(ms, 0), 65535);
  if (this._digitalReportsTimeoutId) {
    clearInterval(this._digitalReportsTimeoutId);
    this._digitalReportsTimeoutId = setTimeout(
      this._digitalReportsTick.bind(this),
      this._samplingInterval
    );
  }
  if (this._analogReportsTimeoutId) {
    clearInterval(this._analogReportsTimeoutId);
    this._analogReportsTimeoutId = setTimeout(
      this._analogReportsTick.bind(this),
      this._samplingInterval
    );
  }
}

OdroidIO.prototype.digitalWrite = function(pin, value) {
  var pinData = this._pins[this.normalize(pin)];

  if (pinData.mode === this.MODES.INPUT) {
    if (value) {
      this._enablePullUpResistor(pinData);
    } else {
      this._enablePullDownResistor(pinData);
    }
  } else {
    if (pinData.mode !== this.MODES.OUTPUT) {
      this.pinMode(pin, this.MODES.OUTPUT);
    }

    if (pinData.isLed) {
      this._digitalWriteLedSync(pinData, value);
    } else {
      this._digitalWriteSync(pinData, value);
    }

    pinData.value = value;
  }

  return this;
};

OdroidIO.prototype.analogRead = function(pin, handler) {
  var pinIndex = this.normalize(pin),
    pinData = this._pins[pinIndex],
    event = 'analog-read-' + pinIndex;

  if (pinData.mode !== this.MODES.ANALOG) {
    this.pinMode(pin, this.MODES.ANALOG);
  }

  pinData.report = 1;

  this._analogReports[pinIndex] = {
    pinData: pinData,
    event: event
  }

  this.on(event, handler);

  if (!this._analogReportsTimeoutId) {
    this._analogReportsTimeoutId = setTimeout(
      this._analogReportsTick.bind(this),
      this._samplingInterval
    );
  }

  return this;
};

OdroidIO.prototype.pwmWrite = function(pin, value) {
  var pinData = this._pins[this.normalize(pin)];

  if (pinData.mode !== this.MODES.PWM) {
    this.pinMode(pin, this.MODES.PWM);
  }

  this._pwmWriteSync(pinData, value);

  pinData.value = value;

  return this;
};

OdroidIO.prototype.analogWrite = OdroidIO.prototype.pwmWrite;

OdroidIO.prototype.servoConfig = function(pin, min, max) {
  var pinData = this._pins[this.normalize(pin)];

  if (pinData.mode !== this.MODES.SERVO) {
    this.pinMode(pin, this.MODES.SERVO);
  }

  if (!Number.isInteger(min)) {
    throw new Error('min value for a servo must be an integer');
  }

  if (!Number.isInteger(max)) {
    throw new Error('max value for a servo must be an integer');
  }

  // 544 is a magic number from the arduino servo library
  if (min < 544) {
    throw new Error('min value for a servo must be >= 544');
  }

  pinData.servoConfig.min = min;
  pinData.servoConfig.max = max;

  return this;
};

OdroidIO.prototype.servoWrite = function(pin, value) {
  var pinData = this._pins[this.normalize(pin)];

  if (pinData.mode !== this.MODES.SERVO) {
    this.pinMode(pin, this.MODES.SERVO);
  }

  // value < 544 implies degrees
  // value >= 544 implies microseconds
  // 544 is a magic number from the arduino servo library
  if (value < 544) {
    value = constrain(value, 0, 180);
  } else {
    value = constrain(
      value, pinData.servoConfig.min, pinData.servoConfig.max
    );
  }

  this._servoWriteSync(pinData, value);

  pinData.value = value;

  return this;
};

OdroidIO.prototype.pingRead = function(options, handler) {
  var pinIndex = this.normalize(options.pin),
    pinData = this._pins[pinIndex],
    event = 'ping-read-' + pinIndex;

  if (pinData.supportedModes.indexOf(this.MODES.INPUT) === -1 ||
      pinData.supportedModes.indexOf(this.MODES.OUTPUT) === -1) {
    throw new Error('Pin for pingRead must support INPUT and OUTPUT modes');
  }

  this.once(event, handler);

  if (pinData.report === 0) {
    pinData.report = 1;

    // If an attempt is made to measure proximity with two or more HC-SR04
    // sensors concurrently the sound pulses from the different sensors can
    // interfere with each other. The lock here prevents this from happening.
    this._pingReadLock(function (release) {
      // Note that the _pingRead callback does not have an err argument. If
      // _pingRead can't measure proximity it calls the callback with the
      // microseconds argument set to 0.
      this._pingRead(pinData, function(microseconds) {
        pinData.value = microseconds;

        this.emit(event, microseconds);

        pinData.report = 0;

        release();
      }.bind(this));
    }.bind(this));
  }

  return this;
};

OdroidIO.prototype.i2cConfig = function(options) {
  // note that there's a design flaw here
  // two devices with the same address on different buses doesn't work
  // see https://github.com/rwaldron/io-plugins/issues/13

  // options.address is _always_ sent by all I2C component classes in
  // Johnny-Five
  var address = options.address;

  // options.bus is optional
  var bus = typeof(options.bus) !== 'undefined' ? options.bus : this._defaultI2cBus;

  // associate the address to the bus
  if (!this._addressToBus.hasOwnProperty(address)) {
    this._addressToBus[address] = bus;
  }

  // create an i2c-bus object for the I2C bus
  if (!this._i2cBuses.hasOwnProperty(bus)) {
    this._i2cBuses[bus] = i2cBus.openSync(bus);
  }

  return this;
};

OdroidIO.prototype.i2cWrite = function(address, cmdRegOrData, inBytes) {
  var i2c = this._i2cBuses[this._addressToBus[address]];

  // if i2cWrite was used for an i2cWriteReg call...
  if (arguments.length === 3 &&
      !Array.isArray(cmdRegOrData) &&
      !Array.isArray(inBytes)) {
    return this.i2cWriteReg(address, cmdRegOrData, inBytes);
  }

  // fix arguments if called with Firmata.js API
  if (arguments.length === 2) {
    if (Array.isArray(cmdRegOrData)) {
      inBytes = cmdRegOrData.slice();
      cmdRegOrData = inBytes.shift();
    } else {
      inBytes = [];
    }
  }

  var buffer = Buffer.from([cmdRegOrData].concat(inBytes));

  // only write if bytes provided
  if (buffer.length) {
    i2c.i2cWriteSync(address, buffer.length, buffer);
  }
  return this;
};

OdroidIO.prototype.i2cWriteReg = function(address, register, byte) {
  var i2c = this._i2cBuses[this._addressToBus[address]];

  i2c.writeByteSync(address, register, byte);

  return this;
};

OdroidIO.prototype.i2cRead = function(address, register, size, handler) {
  // fix arguments if called with Firmata.js API
  if (arguments.length === 3 &&
      typeof register === 'number' &&
      typeof size === 'function') {
    handler = size;
    size = register;
    register = null;
  }

  var continuousRead = function() {
    this.i2cReadOnce(address, register, size, function(bytes) {
      handler(bytes);
      setTimeout(continuousRead, this._samplingInterval);
    });
  }.bind(this);

  continuousRead();

  return this;
};

OdroidIO.prototype.i2cReadOnce = function(address, register, size, handler) {
  // fix arguments if called with Firmata.js API
  if (arguments.length === 3 &&
      typeof register === 'number' &&
      typeof size === 'function') {
    handler = size;
    size = register;
    register = null;
  }

  var event = 'I2C-reply' + address + '-' + (register !== null ? register : 0);

  var afterRead = function (err, bytesRead, buffer) {
    if (err) {
      return this.emit('error', err);
    }

    // convert buffer to an Array before emit
    this.emit(event, Array.prototype.slice.call(buffer));
  }.bind(this);

  if (typeof handler === 'function') {
    this.once(event, handler);
  }

  var i2c = this._i2cBuses[this._addressToBus[address]];
  var data = Buffer.alloc(size);

  if (register !== null) {
    i2c.readI2cBlock(address, register, size, data, afterRead);
  } else {
    i2c.i2cRead(address, size, data, afterRead);
  }

  return this;
};

OdroidIO.prototype._digitalReportsTick = function() {
  this._digitalReports.forEach(function (report) {
    var value = this._digitalReadSync(report.pinData);

    if (value !== report.pinData.value) {
      report.pinData.value = value;
      this.emit(report.event, value);
    }
  }.bind(this));

  this._digitalReportsTimeoutId = setTimeout(
    this._digitalReportsTick.bind(this),
    this._samplingInterval
  );
};

OdroidIO.prototype._analogReportsTick = function() {
  var reports = this._analogReports.filter(function (report) {
      return report;
    });
  var reportsProcessed = 0;

  reports.forEach(function (report) {
    this._analogRead(report.pinData, function (err, value) {
      if (err) {
        this.emit('error', err);
      } else {
        if (value !== report.pinData.value) {
          report.pinData.value = value;
          this.emit(report.event, value);
        }
      }

      reportsProcessed += 1;

      if (reportsProcessed === reports.length) {
        this._analogReportsTickTimeoutId = setTimeout(
          this._analogReportsTick.bind(this),
          this._samplingInterval
        );
      }
    }.bind(this));
  }.bind(this));
};

OdroidIO.prototype._pinModeInput = function(pinData) {
  pinData.gpio = new Gpio(pinData.gpioNo, 'in');
};

OdroidIO.prototype._pinModeOutput = function(pinData) {
  pinData.gpio = new Gpio(pinData.gpioNo, 'out');
};

OdroidIO.prototype._pinModeLed = function(pinData) {
  pinData.led = new Led(pinData.ledPath);
};

OdroidIO.prototype._pinModeAnalog = function(pinData) {};

OdroidIO.prototype._pinModePwm = function(pinData) {};

OdroidIO.prototype._pinModeServo = function(pinData) {
  throw new Error('SERVO mode is not supported');
};

OdroidIO.prototype._enablePullUpResistor = function(pinData) {
  throw new Error('Enable pull-up resistor not supported');
};

OdroidIO.prototype._enablePullDownResistor = function(pinData) {
  throw new Error('Enable pull-down resistor not supported');
};

OdroidIO.prototype._digitalReadSync = function(pinData) {
  return pinData.gpio.readSync();
};

OdroidIO.prototype._digitalWriteSync = function(pinData, value) {
  pinData.gpio.writeSync(value);
};

OdroidIO.prototype._digitalWriteLedSync = function(pinData, value) {
  if (value) {
    pinData.led.on();
  } else {
    pinData.led.off();
  }
};

OdroidIO.prototype._analogRead = function(pinData, callback) {
  AnalogReader.readAnalogChannel(pinData.analogChannel, callback);
};

OdroidIO.prototype._pwmWriteSync = function(pinData, value) {
  throw new Error('pwmWrite is not supported');
};

OdroidIO.prototype._servoWriteSync = function(pinData, value) {
  throw new Error('servoWrite is not supported');
};

OdroidIO.prototype._pingRead = function(pinData, callback) {
  throw new Error('pingRead is not supported');
};

module.exports = OdroidIO;

