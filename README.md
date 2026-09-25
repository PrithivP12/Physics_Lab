# Physics Simulator

**Turn the real world into a physics sandbox.**

Physics Simulator lets you take a picture of something around you and turn it into a playable 2D physics scene.

Take a webcam snapshot or upload a photo, and the app tries to recognize objects in the image and turn their outlines into collision surfaces. Once the scene is built, you can drop objects into it, change gravity, give surfaces different behaviors, create simple rules, or switch over to Lab mode and actually run physics experiments.

The simulation and image processing run in the browser. Camera frames stay on your device and are never uploaded anywhere.

## How it works

The basic process looks like this:

Camera photo or uploaded image

↓

Object detection with MediaPipe EfficientDet-Lite0

↓

Object segmentation to estimate each object's outline

↓

Convert those outlines into Matter.js collision surfaces

↓

Run the scene as a physics sandbox

↓

Add custom behaviors and rules

When you press **Start Camera**, the app briefly opens your webcam, captures one still image, closes the camera stream, and builds the world from that image.

**Import Photo** does the same thing using an uploaded picture.

The object detector first finds common objects in the scene. A segmentation model then tries to trace their shapes so the collision surfaces follow the actual object instead of just using a rectangle. If segmentation fails, the app falls back to the detected object's bounding box.

The system is not doing full 3D reconstruction. It is basically building a 2D physics interpretation of what the camera sees, so complicated objects or cluttered scenes will not always be perfect.

If something gets missed, you can add your own collision surface with **Manual Surface** and adjust it using **Edit Endpoints**.

## Sandbox mode

Once the world is scanned, you can treat it more like a physics playground.

You can spawn:

- Balls
- Cubes
- Heavy balls
- Bouncy balls
- A burst of 10 balls at once

You can also click surfaces and give them special abilities.

Available surface powers include:

- Ice
- Bouncy
- Trampoline
- Magnet
- Gravity switch
- Spawner
- Portals

There is also a simple rule system built around:

**when something touches this → do something**

For example, a collision can:

- Change gravity
- Spawn objects
- Clear objects
- Increase bounce
- Change speed
- Teleport an object
- Create an explosion-style impulse

There are also preset worlds including:

- Normal
- Moon Room
- Chaos
- Pinball
- Zero-G

Gravity can be changed between Earth, Moon, Mars, Jupiter, or zero gravity, and the gravity direction itself can be changed too.

You can pause the simulation or run it in slow motion.

## Building the world manually

The detector will not always recognize everything, so you are not stuck with whatever it finds.

You can draw your own surfaces directly onto the scene, create straight manual surfaces, move their endpoints, undo changes, and clear only the surfaces you created without deleting the automatically detected ones.

There is also a collider visibility option so you can actually see what the physics engine thinks the scene looks like.

## Challenges

The simulator also has small challenge tools built in.

You can place targets, create rule-based challenges, track time, count spawned objects and resets, and keep score.

The goal was to make the sandbox usable for more than just dropping balls on things.

## Lab mode

Lab mode is the more serious side of the project.

Instead of using fictional surface powers, Lab mode turns the scene into something closer to a physics experiment.

When Lab mode is enabled, things like portals, magnets, touch rules, and super-bounce surfaces are disabled. The scanned objects are still used as collision surfaces, but the focus changes from messing around with the simulation to measuring what is happening.

You can inspect:

- Position
- Velocity
- Acceleration
- Mechanical energy
- Force vectors
- Motion trails
- Free-body diagrams
- Scientific graphs

There are also tools for:

- Measuring distance
- Measuring angles
- Timing motion
- Applying forces
- Changing model mass
- Changing surface properties
- Launching projectiles
- Creating springs

The graph records position, velocity, acceleration, and energy for the selected object at around 10 measurements per simulation second.

Experiment data can also be exported as CSV.

## Experiments

Lab mode includes several built-in experiments.

### Free fall

Drop an object and compare its motion with the expected behavior under gravity.

The experiment reports the object's height exactly 0.5 simulation seconds after release using interpolation between physics steps.

Objects already in the camera scene can still interfere with the falling object, which is intentional.

### Projectile motion

Launch an object and compare its predicted range with what happens in the simulation.

### Energy

Track kinetic and potential energy while an object moves.

### Springs

The spring follows the model:

`F = -kx`

The spring constant is measured in model kg/s².

The period experiment watches the mass cross the center of the spring several times and estimates the oscillation period.

Objects in the scanned scene can still collide with the moving spring mass.

### Newton's second law

Apply a constant force to a body in Zero-G and measure its acceleration over 0.5 simulation seconds.

The experiment can then compare the measured result with:

`F = ma`

### Friction

Give an object an initial velocity on a level surface and apply a controlled friction force:

`F = -μmg`

The measured stopping distance can be compared with:

`d = v₀² / (2μg)`

### Momentum

Two objects collide in Zero-G.

The experiment records both objects' velocities and total momentum before and after the first collision.

You can test either an elastic collision or a perfectly inelastic one.

Because the measurements come directly from a numerical physics engine, very small differences in momentum can happen.

### Torque

There is also a separate ideal pinned-beam model.

The beam uses:

`I = mL² / 12`

`τ = rF`

`α = τ / I`

You can change the beam's mass, length, lever arm, and applied force and watch its angle, angular speed, angular acceleration, torque, and moment of inertia update live.

The beam is an ideal model drawn separately from the Matter.js world, so other objects do not collide with it.

## Electric fields

Lab mode also includes a simple electric-charge model.

You can place positive and negative charges and move them around the scene.

The simulator estimates Coulomb forces between the charges and displays an electric-field arrow grid.

The force model uses a softened inverse-square equation so two charges overlapping do not create an infinite force.

Electric potential energy is also included in the Lab readings.

The values here are model values rather than measurements of real physical charges.

## Magnetic fields

You can also enable a uniform magnetic field.

The field strength and direction can be changed, and charged particles experience a Lorentz-force-style effect.

There is also a charged-particle orbit demo.

Instead of directly adding a force every frame, the simulation rotates the particle's velocity slightly each physics step based on `qB/m`. This keeps the particle's speed roughly constant when only the magnetic field is acting on it.

The electric and magnetic demos automatically use Zero-G so gravity does not hide the field effects.

## Units and calibration

By default, the simulator does not know the real size of anything in a photograph.

So without calibration:

**100 screen pixels = 1 simulated unit (su)**

That means:

- Position is measured in `su`
- Velocity is measured in `su/s`
- Acceleration is measured in `su/s²`

The physics simulation runs at 60 steps per simulation second.

Gravity values use the same simulated units. For example, Earth gravity is modeled as:

`9.81 su/s²`

The coordinate system treats upward as positive `y`.

If you want measurements in metres, you can calibrate the scene.

Choose **Scale**, enter the real length of something visible in the image, and drag across that object.

The simulator then calculates how many pixels correspond to one metre.

After calibration, distances are displayed in metres instead of simulated units.

The app also treats one Matter.js mass unit as one **model kilogram**.

With both mass and distance defined, kinetic and gravitational potential energy can be shown as model joules.

These are still predictions produced by the simulation. The camera is not measuring the real mass, friction, gravity, or material properties of the objects in the photo.

If the window is resized, calibration is removed because the relationship between the image pixels and the scene changes. Scanned camera colliders are also removed and need to be scanned again.

## Forces and measurements

Some measurements are estimates because Matter.js does not expose every physical quantity directly.

For example, contact forces from collisions are not displayed as exact force magnitudes. Normal-force and friction arrows mainly show direction.

Net force is estimated using:

`F = ma`

using the object's model mass and its measured acceleration.

The stopwatch uses simulation time, so pausing the world or using slow motion affects the stopwatch too.

The collision ledger records:

- Each object's velocity before the collision
- Each object's velocity after the collision
- Total x-momentum
- Total y-momentum

## Energy calculations

The simulator tracks kinetic and potential energy for the selected object.

Spring potential energy and electric potential energy can also be included.

For electric systems, the displayed potential energy belongs to the selected charge interacting with the other charges.

Adding the displayed energy for every charge would count each pair twice, so the selected object's `K + U` should be treated as a useful diagnostic rather than the total conserved energy of a many-charge system.

## Tech stack

The project uses:

- React
- TypeScript
- Vite
- MediaPipe Tasks Vision
- Matter.js
- Abacus visit counter
- HTML Canvas
- Browser webcam APIs

One small Vercel Function records page visits through Abacus.

There is also:

- No account system
- No app-owned database
- No API key
- No paid service

The EfficientDet-Lite0 object detector, MagicTouch segmentation model, and MediaPipe WebAssembly files are stored directly inside the project under:

`public/models`

and

`public/mediapipe`

The detector is trained on common COCO object categories, so it is much better at recognizing normal objects like bottles, books, cups, chairs, and similar things than unusual objects.

The segmentation model is used to estimate object silhouettes.

## Privacy

Camera processing happens locally in the browser.

When you press **Start Camera**, the webcam stream is only opened long enough to capture the frame. The stream is then closed.

The image is processed on the device and is not sent to a server.

Imported photos are handled locally too.

The visit total uses [Abacus](https://v2.jasoncameron.dev/abacus/) through a same-origin Vercel Function. Each site load records a visit, including repeat visits. The visible total refreshes every 15 seconds while the page is open without recording another visit. Camera images and imported photos are never included. Local development previews read the total without adding a visit.

## Limitations

This is still a 2D simulation built from a single image, so there are a few obvious limitations.

The detector can completely miss objects it does not recognize.

Segmentation can also produce weird outlines when objects overlap, lighting is bad, or the background is cluttered.

The system does not know the real depth, mass, material, or 3D shape of an object. It only sees the visible 2D image.

Camera images fill the viewport, while imported images are shown completely with letterboxing when necessary. Detection coordinates are adjusted to match whichever display mode is being used.

Portals and touch rules use short cooldowns so objects do not repeatedly trigger the same behavior every simulation frame.

For the easiest camera scan, point the camera at a clear object such as a bottle, book, or cup in decent lighting.

If the detector misses something, go to:

**World → Edit / Import → Manual Surface**

Then draw along the edge you want the simulator to treat as solid.

## Future ideas

There are still a lot of things I would like to add.

Some of the main ideas are:

- Hand tracking
- Better object silhouettes
- Full-room scanning
- Mobile AR
- Multiplayer
- Saved worlds
- Shareable worlds

The bigger goal is to eventually make the line between a normal physics simulator and the real environment around you feel a lot smaller.
