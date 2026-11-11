# Tern & Floe voyage shortlisting

How Tern & Floe specialists turn a customer call into a short, impartial list of Antarctic departures. Tern & Floe and every operator and ship are fictional.

## People

**Specialist**:
A Tern & Floe staff member who talks to customers and builds their shortlists.
_Avoid_: user, agent, advisor

**Customer**:
The person or party planning to travel. Customers never see the tool directly.
_Avoid_: client, user, passenger, traveller

**Operator**:
A company that runs expedition ships and sells departures through Tern & Floe.
_Avoid_: supplier, cruise line, partner

## What is sold

**Voyage**:
A named itinerary sailed by one ship, such as a ten-night classic Peninsula trip.
_Avoid_: trip, cruise, itinerary

**Route**:
The kind of voyage: Peninsula, Antarctic Circle, Falklands and South Georgia, or fly-cruise.
_Avoid_: itinerary type

**Fly-cruise**:
A voyage where passengers fly over the Drake Passage instead of sailing it.
_Avoid_: air-cruise

**Departure**:
One dated sailing of a voyage, with a start date and an end date.
_Avoid_: sailing, date, trip

**Cabin category**:
A class of cabin on a ship, such as a triple, a twin with window or a suite, with a number of beds.
_Avoid_: room type, cabin grade

**Fare**:
The price per person, any solo price, and the berths left for one cabin category on one departure.
_Avoid_: rate, price row

**Berth**:
One bed in a cabin. Availability is counted in berths, not cabins.
_Avoid_: place, space, cabin (when counting availability)

**Solo price**:
The price a customer travelling alone pays for a cabin to themselves.
_Avoid_: single supplement

**Activity**:
An optional, limited-place excursion on a departure, such as kayaking or camping, often booked separately.
_Avoid_: add-on, excursion

## Finding a fit

**Draft brief**:
What the tool reads from the specialist's call notes, before the specialist has checked it.
_Avoid_: extraction, parsed notes

**Brief**:
A customer's needs once the specialist has checked them: date window, budget per person, party, solo preference, must-have activities and soft preferences.
_Avoid_: criteria, request, search, query

**Date window**:
The earliest start and latest end a customer can travel. A departure fits only if the whole voyage falls inside it.
_Avoid_: travel dates, date range

**Budget**:
The most a customer will pay per person. It is a hard ceiling. A total budget is converted to per person by dividing by the party size.
_Avoid_: price range, spend

**Party**:
Everyone travelling together on one booking. A party always travels in a single cabin category.
_Avoid_: group, booking, pax

**Solo preference**:
For a party of one: own cabin, will share, or either. Either is assumed when the notes don't say.
_Avoid_: single option

**Hard rule**:
A yes-or-no condition a departure must meet: date window, budget, berths, solo option and must-have activities.
_Avoid_: filter, constraint

**Soft preference**:
Something a customer cares about that isn't yes or no, such as pace, ship size, seasickness or wildlife.
_Avoid_: nice-to-have, soft criterion

**Candidate**:
A departure that meets every hard rule for a brief, together with each of its fares that qualifies.
_Avoid_: result, option, hit

**Qualifying fare**:
A fare on a departure that meets the budget, berth and solo rules for a brief.
_Avoid_: eligible fare, matching fare

**Near miss**:
A departure that breaks exactly one hard rule, labelled with the rule and by how much.
_Avoid_: alternative, fallback, almost-match

**Shortlist**:
The top three picks for a brief, with a comparison and a draft email for the specialist to edit.
_Avoid_: recommendations, results

**Pick**:
One departure and cabin category on a shortlist, with the reason it fits and one trade-off.
_Avoid_: recommendation, result

**Saved brief**:
A brief the specialist keeps so the tool can look for new matches later.
_Avoid_: alert, watch, subscription

**Match**:
A departure that has become a candidate for a saved brief for the first time since the brief was saved. A match that stops fitting is no longer available, not removed.
_Avoid_: alert, new result

**Availability import**:
A file of fares from an operator that updates prices and berths on existing departures. It applies completely or not at all.
_Avoid_: feed, sync, upload

**Availability as of**:
When a departure's fares were last updated from the operator. Shown on every shortlist.
_Avoid_: last synced, freshness
