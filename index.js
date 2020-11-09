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

app.get('/', (request, response) => {
  const data = {
    "apiversion": "1",
    "author": "Jimmy",
    "color": '#0F52BA',
    "head": "bwc-snowman",
    "tail": "bwc-bonhomme"
  }
  return response.json(data)
})

app.post('/start', (request, response) => {
  return response.json({});
})

function shuffle_array(arr) {
  let i, j, temp
  for (i = arr.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1))
    temp = arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }
  return arr
}

function get_move_pos(x_head, y_head, move) {
  if (move == "up") return [x_head, y_head + 1]
  else if (move == "left") return [x_head - 1, y_head]
  else if (move == "down") return [x_head, y_head - 1]
  else return [x_head + 1, y_head]
}

const stringify = (coord) => { return coord[0].toString() + "," + coord[1].toString() }

const get_north = (coord) => { return [coord[0], coord[1] + 1] }
const get_west = (coord) => { return [coord[0] - 1, coord[1]] }
const get_south = (coord) => { return [coord[0], coord[1] - 1] }
const get_east = (coord) => { return [coord[0] + 1, coord[1]] }

let obstacles_coord
let heads_coord
let enemy_potential_moves_coord
let current_tails_coord
let edges_coord
let foods_coord

function set_obstacles_coord(req) {
  let i;

  let snakes = req.body.board.snakes
  for (let snake of snakes) {
    let snake_body = snake.body

    set_heads_coord([snake_body[0].x, snake_body[0].y], snake_body.length)
    set_enemy_potential_moves_coord(req, [snake_body[0].x, snake_body[0].y], snake_body.length)

    for (i = 0; i < snake_body.length - 2; i++) obstacles_coord[stringify([snake_body[i].x, snake_body[i].y])] = "body"
    // If a snake ate, its body size in the next turn will be incremented by 1 and
    // the second last position will be on top of the last (grown) position
    // so that space will be successfully registered as an obstacle in this case.
    // Note that the tail below is a tail of the next turn and not the current turn.
    obstacles_coord[stringify([snake_body[snake_body.length - 2].x, snake_body[snake_body.length - 2].y])] = "future_tail"

    set_current_tails_coord([snake_body[snake_body.length - 1].x, snake_body[snake_body.length - 1].y])
  }

  let x_max = req.body.board.width
  let y_max = req.body.board.height
  for (i = 0; i < x_max; i++) {
    obstacles_coord[stringify([i, -1])] = "wall" // Bottom wall
    set_edges_coord([i, -1])
    obstacles_coord[stringify([i, y_max])] = "wall" // Top wall
    set_edges_coord([i, y_max])
  }
  for (i = 0; i < y_max; i++) {
    obstacles_coord[stringify([-1, i])] = "wall" // Left wall
    set_edges_coord([-1, i])
    obstacles_coord[stringify([x_max, i])] = "wall" // Right wall
    set_edges_coord([x_max, i])
  }
}

function set_heads_coord(head_coord, snake_length) {
  heads_coord[stringify(head_coord)] = snake_length
}

function set_enemy_potential_moves_coord(req, head_coord, snake_length) {
  if (is_my_head(req, head_coord)) return
  let futures = [get_north(head_coord), get_west(head_coord), get_south(head_coord), get_east(head_coord)]
  for (let future of futures) {
    let stringed_future = stringify(future)
    if (stringed_future in enemy_potential_moves_coord)
      enemy_potential_moves_coord[stringed_future] = Math.max(enemy_potential_moves_coord[stringed_future], snake_length)
    else
      enemy_potential_moves_coord[stringed_future] = snake_length
  }
}

function set_current_tails_coord(current_tail_coord) {
  current_tails_coord[stringify(current_tail_coord)] = "current_tail"
}

function set_edges_coord(wall_coord) {
  let futures = [get_north(wall_coord), get_west(wall_coord), get_south(wall_coord), get_east(wall_coord)]
  for (let future of futures) edges_coord[stringify(future)] = "edge"
}

function set_foods_coord(req) {
  let foods = req.body.board.food
  for (let food of foods) foods_coord[stringify([food.x, food.y])] = "food"
}

function is_legal_move(req, move) {
  // Make sure it doesn't eat itself and collide with obstacles
  let x_head = req.body.you.body[0].x
  let y_head = req.body.you.body[0].y
  let move_pos = get_move_pos(x_head, y_head, move)
  return !(stringify(move_pos) in obstacles_coord)
}

function is_my_head(req, curr_coord) {
  let x_head = req.body.you.body[0].x
  let y_head = req.body.you.body[0].y
  let my_head_coord = [x_head, y_head]
  return stringify(curr_coord) == stringify(my_head_coord)
}

function is_bigger_enemy_potential_move(my_length, curr_coord) {
  return stringify(curr_coord) in enemy_potential_moves_coord && enemy_potential_moves_coord[stringify(curr_coord)] > my_length
}

function is_enemy_potential_move(curr_coord) {
  return stringify(curr_coord) in enemy_potential_moves_coord
}

function is_current_tail(curr_coord) {
  return stringify(curr_coord) in current_tails_coord
}

function is_edge(curr_coord) {
  return stringify(curr_coord) in edges_coord
}

function is_food(curr_coord) {
  return stringify(curr_coord) in foods_coord
}

const DEPTH_PARAMETER_DIVISOR = process.env.DEPTH_PARAMETER_DIVISOR || 10
const HEALTH_THRESHOLD = process.env.HEALTH_THRESHOLD || 25
const SIZE_TO_DIET = process.env.SIZE_TO_DIET || 20
const TIME_TO_AVOID_HEADS = process.env.TIME_TO_AVOID_HEADS || 30
const TIME_TO_CHASE_TAILS = process.env.TIME_TO_CHASE_TAILS || 50

function transform_battle_score(enemy_length, my_length, score) {
  if (enemy_length > my_length)
    return score - 20
  if (enemy_length == my_length)
    return score - 15
  return score
}

function transform_food_score(req, score, curr_depth = 0) {
  if (req.body.you.body.length < SIZE_TO_DIET || req.body.you.health < HEALTH_THRESHOLD)
    return score + curr_depth + 5
  return score
}

function transform_head_avoid_score(req, score, curr_depth) {
  if (req.body.turn > TIME_TO_AVOID_HEADS)
    return score - curr_depth
  return score
}

function transform_tail_chase_score(req, score, curr_depth) {
  if (req.body.turn > TIME_TO_CHASE_TAILS)
    return score + curr_depth
  return score
}

function local_space_score(req, move) {
  let score = 0

  let x_head = req.body.you.body[0].x
  let y_head = req.body.you.body[0].y
  let move_pos = get_move_pos(x_head, y_head, move)
  let futures = [get_north(move_pos), get_west(move_pos), get_south(move_pos), get_east(move_pos)]
  let my_length = req.body.you.body.length

  for (let future of futures) {
    if (stringify(future) in obstacles_coord && !is_my_head(req, future)) {
      score -= 1 // Decrement score by 1 for every immediate obstacle
      if (stringify(future) in heads_coord) score = transform_battle_score(heads_coord[stringify(future)], my_length, score)
    } else if (is_food(future) && !is_bigger_enemy_potential_move(my_length, future)) {
      score = transform_food_score(req, score)
    }
  }

  if (is_food(move_pos) && !is_bigger_enemy_potential_move(my_length, move_pos)) score = transform_food_score(req, score)

  return score
}

function limited_BFS(req, queue, marked, score) {
  let curr = queue.shift()
  let curr_coord = curr[0]
  let curr_depth = curr[1]

  score.s += 1 // Increment score by 1 for every non-obstacle space explored
  if (is_bigger_enemy_potential_move(req.body.you.body.length, curr_coord)) {
    score.s = transform_head_avoid_score(req, score.s, curr_depth)
  } else {
    if (is_food(curr_coord)) score.s = transform_food_score(req, score.s, curr_depth)
    if (is_current_tail(curr_coord)) score.s = transform_tail_chase_score(req, score.s, curr_depth)
  }

  let futures = [get_north(curr_coord), get_west(curr_coord), get_south(curr_coord), get_east(curr_coord)]

  if (!is_edge(curr_coord) || !is_enemy_potential_move(curr_coord)) {
    for (let future of futures) {
      let stringed_future = stringify(future)
      if ((curr_depth > 0) &&
          !(stringed_future in marked) &&
          !(stringed_future in obstacles_coord && obstacles_coord[stringed_future] != "future_tail")) {
        marked[stringed_future] = "marked"
        queue.push([future, curr_depth - 1])
      }
    }
  }

  if (queue.length > 0) limited_BFS(req, queue, marked, score)
}

function global_space_score(req, move) {
  let x_head = req.body.you.body[0].x
  let y_head = req.body.you.body[0].y
  let move_pos = get_move_pos(x_head, y_head, move)

  let depth = Math.ceil(req.body.turn / DEPTH_PARAMETER_DIVISOR)
  let queue = [[move_pos, depth]] // List of (coord, depth) pairs

  let marked = {}
  marked[stringify(move_pos)] = "marked"

  let score = { "s": 0 }
  limited_BFS(req, queue, marked, score)
  return score.s
}

function get_best_move(req) {
  let moves = shuffle_array(["up", "left", "down", "right"])
  moves = moves.map(move => [move, 0])
  moves = moves.filter(move => is_legal_move(req, move[0]))
  if (moves.length == 0) {
    console.log("====== No legal moves available ======")
    return "up"
  }
  
  moves = moves.map(move => [move[0], move[1] + local_space_score(req, move[0])])
  moves = moves.map(move => [move[0], move[1] + global_space_score(req, move[0])])

  moves.sort((a, b) => b[1] - a[1])
  console.log("Turn: " + req.body.turn + ". Move rankings ======> " + moves)
  return moves[0][0] // Move with the highest score
}

app.post('/move', (req, res) => {
  const data = {
    move: "up"
  }
  obstacles_coord = {}
  heads_coord = {}
  enemy_potential_moves_coord = {}
  current_tails_coord = {}
  edges_coord = {}
  foods_coord = {}
  set_obstacles_coord(req)
  set_foods_coord(req)
  data.move = get_best_move(req)

  return res.json(data)
})

app.post('/end', (request, response) => {
  return response.json({})
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
