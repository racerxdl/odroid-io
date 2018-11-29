# ODROID-IO

ODROID-IO is a Johnny-Five I/O Plugin for Odroid C2
[IO Plugin](https://github.com/rwaldron/io-plugins) for
[Johnny-Five](https://github.com/rwaldron/johnny-five). It extends
[board-io](https://github.com/achingbrain/board-io) to provide Linux
implementations for the following features that IO Plugins can support:

 * Digital IO
   * Implementation based on the [GPIO sysfs interface](https://www.kernel.org/doc/Documentation/gpio/sysfs.txt) using [onoff](https://github.com/fivdi/onoff)
 * I2C
   * Implementation based on the [/dev interface](https://www.kernel.org/doc/Documentation/i2c/dev-interface) using [i2c-bus](https://github.com/fivdi/i2c-bus)

## Installation

```
npm install odroid-io
```

## Johnny-Five Features Supported

The Johnny-Five features supported by a platform are summarized in tables on
the [Platform Support](http://johnny-five.io/platform-support/) page. The
features supported by Linux-IO shown in the following table:

Feature | Support
:--- | :---
Analog Read | yes
Digital Read | yes
Digital Write | yes
PWM | no
Servo | no
I2C | yes
One Wire | no
Stepper | no
Serial/UART | no
DAC | no
Ping | no

## Usage

Here's a minimalistic IO Plugin for the Raspberry Pi called
[TinyRaspberryPiIO](https://github.com/fivdi/linux-io/blob/master/example/raspberry-pi/tiny-raspberry-pi-io.js)
that allows digital IO on GPIO4 and GPIO17 and I2C serial bus access on I2C
bus 1. The built-in LED can also be used.

```js
'use strict';

var five = require('johnny-five');
var OdroidIO = require('./odroid-io');

var board = new five.Board({
  io: new OdroidIO()
});

board.on('ready', function() {
  console.log('Board Ready');
  var adc = new five.Pin({
  pin: 'A0',
  type: 'analog',
  });
  adc.read(function(err, val) {
  if (err) {
    console.log('Error reading ADC: ', err);
  } else {
    console.log('ADC Value: ' + val);
  }
  });
});

```

If an ADXL345 accelerometer is connected to I2C bus 1, the following
[program](https://github.com/fivdi/linux-io/blob/master/example/raspberry-pi/i2c-accelerometer.js)
will print information provided by accelerometer.

```js
var five = require('johnny-five');
var OdroidIO = require('odroid-io');

var board = new five.Board({
  io: new OdroidIO()
});

board.on('ready', function() {
  var accelerometer = new five.Accelerometer({
    controller: "ADXL345"
  });

  accelerometer.on("change", function() {
    console.log("accelerometer");
    console.log("  x            : ", this.x);
    console.log("  y            : ", this.y);
    console.log("  z            : ", this.z);
    console.log("  pitch        : ", this.pitch);
    console.log("  roll         : ", this.roll);
    console.log("  acceleration : ", this.acceleration);
    console.log("  inclination  : ", this.inclination);
    console.log("  orientation  : ", this.orientation);
    console.log("--------------------------------------");
  });
});
```
