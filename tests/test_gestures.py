import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'td'))
from gestures import Detector


def fist(scale=1, score=.95):
    points = [{'x': .5, 'y': .55} for _ in range(21)]
    points[0] = {'x': .5, 'y': .5 + .1 * scale}
    points[9] = {'x': .5, 'y': .5 - .1 * scale}
    return {'landmarks': [points], 'gestures': [[{'categoryName': 'Closed_Fist', 'score': score}]]}


def two_hand_heart():
    """Bent index fingers meet above paired thumbs; wrists remain apart."""
    hands = []
    for side in (-1, 1):
        palm_x = .5 + .2 * side
        points = [{'x': palm_x, 'y': .5} for _ in range(21)]
        points[0] = {'x': palm_x, 'y': .6}
        points[9] = {'x': palm_x, 'y': .4}
        points[6] = {'x': .5 + .1 * side, 'y': .4}
        points[7] = {'x': .5, 'y': .26}
        points[8] = {'x': .5 + .01 * side, 'y': .3}
        points[4] = {'x': .5 + .01 * side, 'y': .5}
        hands.append(points)
    return {'landmarks': hands, 'gestures': [[], []]}


class TwoHandHeartEffects(unittest.TestCase):
    def test_two_hand_heart_requires_hold_and_fires_once(self):
        detector = Detector()
        pose = two_hand_heart()
        self.assertIsNone(detector.update(pose, 0))
        self.assertIsNone(detector.update(pose, .29))
        self.assertEqual(detector.update(pose, .31), 'heart')
        for time in (.5, 1.5, 3):
            self.assertIsNone(detector.update(pose, time))

    def test_neutral_release_rearms_heart_after_cooldown(self):
        detector = Detector()
        pose = two_hand_heart()
        detector.update(pose, 0)
        self.assertEqual(detector.update(pose, .31), 'heart')
        neutral = {'landmarks': [], 'gestures': []}
        detector.update(neutral, .4)
        detector.update(neutral, .7)
        self.assertIsNone(detector.update(pose, .71))
        self.assertIsNone(detector.update(pose, 1.02))
        self.assertEqual(detector.update(pose, 1.42), 'heart')
        self.assertIsNone(detector.update(pose, 2.5))

    def test_single_hand_separated_tips_and_inverted_heart_are_rejected(self):
        single = two_hand_heart()
        single['landmarks'] = single['landmarks'][:1]
        single['gestures'] = single['gestures'][:1]
        separated_index = two_hand_heart()
        separated_index['landmarks'][1][8]['x'] = .8
        separated_thumb = two_hand_heart()
        separated_thumb['landmarks'][1][4]['x'] = .8
        inverted = two_hand_heart()
        for points in inverted['landmarks']:
            points[4]['y'] = .2
        for name, pose in [('single hand', single), ('separated index tips', separated_index),
                           ('separated thumb tips', separated_thumb), ('thumbs above index', inverted)]:
            with self.subTest(pose=name):
                detector = Detector()
                for time in (0, .31, 1.5):
                    self.assertIsNone(detector.update(pose, time))


class FistEffects(unittest.TestCase):
    def test_held_fist_cracks_once_until_release(self):
        detector = Detector()
        self.assertIsNone(detector.update(fist(), 0))
        self.assertIsNone(detector.update(fist(), .15))
        self.assertEqual(detector.update(fist(), .35), 'crack')
        for t in (.5, .8, 1.5, 2.5):
            self.assertIsNone(detector.update(fist(), t))
        detector.update({'landmarks': [], 'gestures': []}, 3)
        detector.update({'landmarks': [], 'gestures': []}, 3.3)
        self.assertIsNone(detector.update(fist(), 3.4))
        self.assertEqual(detector.update(fist(), 3.75), 'crack')

    def test_crack_does_not_block_following_forward_punch(self):
        detector = Detector()
        detector.update(fist(), 0)
        self.assertEqual(detector.update(fist(), .35), 'crack')
        self.assertEqual(detector.update(fist(scale=1.4), .45), 'punch')
        self.assertIsNone(detector.update(fist(scale=1.5), .55))

    def test_low_confidence_fist_does_not_crack(self):
        detector = Detector()
        detector.update(fist(score=.4), 0)
        self.assertIsNone(detector.update(fist(score=.4), .5))


if __name__ == '__main__':
    unittest.main()
