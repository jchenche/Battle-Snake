const bodyParser = require('body-parser')
const express = require('express')
const logger = require('morgan')
const app = express()
const {
  fallbackHandler,
  notFoundHandler,
  genericErrorHandler,
  poweredByHandler
} = require('./handlers.js')

// For deployment to Heroku, the port needs to be set using ENV, so
// we check for the port number in process.env
app.set('port', (process.env.PORT || 9001))

app.enable('verbose errors')

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(poweredByHandler)

// --- SNAKE LOGIC GOES BELOW THIS LINE ---

// Handle POST request to '/start'
app.post('/start', (request, response) => {
  // NOTE: Do something here to start the game

  // Response data
  const data = {
    "color": '#0F52BA',
    "headType": "bwc-snowman",
    "tailType": "bwc-bonhomme"
  }

  return response.json(data)
})

var directions = ["up", "left", "down", "right"] // Code depends on the order of array

function get_random_direction() {
  return directions[Math.floor(Math.random() * 4)]
}

function get_snake_orientation(req) {  
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var x_neck = req.body.you.body[1].x
  var y_neck = req.body.you.body[1].y

  if (x_head - x_neck > 0) {
    return "right"
  } else if (x_head - x_neck < 0) {
    return "left"
  } else if (y_head - y_neck > 0) {
    return "down"
  } else {
    return "up"
  }
}

function get_snake_reverse_orientation(req) {
  return directions[(directions.indexOf(get_snake_orientation(req)) + 2) % 4]
}

function avoid_wall(req, data) {
  var x_head = req.body.you.body[0].x
  var y_head = req.body.you.body[0].y
  var x_max = req.body.board.width - 1
  var y_max = req.body.board.height - 1
  var reversed_orientation = get_snake_reverse_orientation(req)

  while ((reversed_orientation == data.move) || // Make sure it doesn't collide itself
      (data.move == "up" && y_head - 1 < 0) ||
      (data.move == "left" && x_head - 1 < 0) ||
      (data.move == "down" && y_head + 1 > y_max) ||
      (data.move == "right" && x_head + 1 > x_max)) {
    data.move = get_random_direction()
  }
}

// Handle POST request to '/move'
app.post('/move', (req, res) => {
  // NOTE: Do something here to generate your move

  // Response data
  const data = {
    move: get_random_direction(), // coordinate (0,0) is at the upper left corner
  }

  avoid_wall(req, data)

  return res.json(data)
})

app.post('/end', (request, response) => {
  // NOTE: Any cleanup when a game is complete.
  return response.json({})
})

app.post('/ping', (request, response) => {
  // Used for checking if this snake is still alive.
  return response.json({});
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
