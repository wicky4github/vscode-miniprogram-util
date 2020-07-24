const EventsEmitter = require('events')

class Bus extends EventsEmitter {

}

module.exports = new Bus()