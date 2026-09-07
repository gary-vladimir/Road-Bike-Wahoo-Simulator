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

this is fully a training app, the focus should be practical and functional but also very visually pleasing given that this is a simulator.

## Developer notes

use .devcontainer for this project, use the available docker tools to manage and create a new .devcontainer, run all code inside that container, feel free to visualize the app in the browser, just make sure to use the browser on THIS computer, i have other computers with the chrome extension and that can cause some confussion.

Use the available blender tool in the given case that you need it, it is currently up and running with the mcp add-on.

commit everything using git, run regular git commits, don't add co-author info.

on an extra note> the wahoo device is currently on, and it is also connected via wifi. feel free to connect directly to it, but be careful!! we don't want to risk accidentally breaking the device. be super careful when trying to control the actual hardware.

If at any point you need manual confirmation feel free to tell me, i can give you visual feedback and i can also literally hop on the bike and tell you if i feel resistance or change, etc etc.

Let's built with caution. having safety is a top priority in this project.

if you have any sort of questions about the app or goal let me know and i will answer.

never ever run code inside my machine, always use the .devcontainer.

## Above and beyond

Feel free to be creative, understand the actual real goal and feel free to add helpful features and nice to have features to the app. be creative, assist in the app solution design process.

let-s start small and build up, you may start only by creating very simple and minimalistic 3D simulation, but then we can grow into adding more and more realistm.

The ultimate dream would be to ride in actual simulated roads that are actually real roads from Oaxaca Mexico.
