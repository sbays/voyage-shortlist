-- The voyage catalogue: who sails, on what, when, and at what price.
-- Price and availability belong to a cabin category on one departure.
-- There is deliberately no commission or margin column anywhere.

CREATE TYPE route AS ENUM (
  'peninsula',
  'antarctic_circle',
  'falklands_south_georgia',
  'fly_cruise'
);

CREATE TABLE operators (
  id   text PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE ships (
  id                 text PRIMARY KEY,
  operator_id        text NOT NULL REFERENCES operators (id),
  name               text NOT NULL UNIQUE,
  passenger_capacity integer NOT NULL CHECK (passenger_capacity > 0)
);

CREATE TABLE voyages (
  id          text PRIMARY KEY,
  ship_id     text NOT NULL REFERENCES ships (id),
  name        text NOT NULL,
  route       route NOT NULL,
  embark_port text NOT NULL,
  nights      integer NOT NULL CHECK (nights > 0)
);

CREATE TABLE departures (
  id                      text PRIMARY KEY,
  voyage_id               text NOT NULL REFERENCES voyages (id),
  start_date              date NOT NULL,
  end_date                date NOT NULL,
  availability_updated_at timestamptz NOT NULL,
  CHECK (end_date > start_date)
);

CREATE INDEX departures_start_date ON departures (start_date);

CREATE TABLE cabin_categories (
  id          text PRIMARY KEY,
  ship_id     text NOT NULL REFERENCES ships (id),
  name        text NOT NULL,
  sleeps      integer NOT NULL CHECK (sleeps > 0),
  description text NOT NULL
);

-- berths_left counts beds, not cabins. solo_price_gbp is the whole price for
-- one person with the cabin to themselves; NULL means no single option.
CREATE TABLE departure_fares (
  departure_id      text NOT NULL REFERENCES departures (id),
  cabin_category_id text NOT NULL REFERENCES cabin_categories (id),
  price_gbp_pp      integer NOT NULL CHECK (price_gbp_pp > 0),
  solo_price_gbp    integer CHECK (solo_price_gbp > 0),
  berths_left       integer NOT NULL CHECK (berths_left >= 0),
  PRIMARY KEY (departure_id, cabin_category_id)
);

CREATE TABLE activities (
  id          text PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text NOT NULL
);

CREATE TABLE departure_activities (
  departure_id text NOT NULL REFERENCES departures (id),
  activity_id  text NOT NULL REFERENCES activities (id),
  places_left  integer NOT NULL CHECK (places_left >= 0),
  price_gbp    integer NOT NULL CHECK (price_gbp >= 0),
  PRIMARY KEY (departure_id, activity_id)
);
