## Context

I have a road bike Giant contender AR 1 and a Wahoo Fitness KICKR Core 2 11 Speed Cassette device. I want to train for a triathlon.

I am currently using the wahoo app, connected with strava. Everything works as expected, the wahoo included gear cassette fits perfectly with the giant road bike gear setup as well.

## The problem

The big issue that i have is that training using only the wahoo app is very boring!! using the app i am able to get metrics and data, and i am able to set resistance for the device, but that's about it. i lack a "real riding" feeling.

## The Porposed Solution

I figured that since the wahoo device connects to bluetooth and i actually own a macbook pro laptop connected to a much larger screen display... i want to built a bike simulator web app that runs locally.

## Core App Minimum Requirements:

The app is a 3D bike POV simulator that works with the wahoo device to achieve a very realistic riding virtual experience.

The app is heavily inspired by the famous rouvy and swift indoor training apps with the following differences:

1. our app runs locally, data is secure and private.
2. we are not competing and connecting with online people, we are individual training focused. more simple, we want to remove unnecessary functionality.
3. We combine the best features of both apps, (rouvy maps and routes + zwift metrics and training presets)
4. Our app is directly focused on the exact hardware that i own, we don't have to worry about compatibility with other types of setups. This simplifies things.
5. our app implements workout templates and presets that can be customized and are "ready to go". in basic words: the user can browse a list of workouts already available, read @cycling_presets.md to understand the different types of options for the user, upon selecting one, the user can hit "start" and the app clearly shows a timer coutdown and the app automatically handles the wahoo device to achieve the desired workout, the simulated 3D road also matches with the selected workout. this means that if the workout is "hill" training, the simulation should clearly reflect this to make things as realistic as possible.
