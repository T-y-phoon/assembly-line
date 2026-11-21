const assembly = '#1828888/#1829316';
const paths = numbers => numbers.map(number => assembly+'/#'+number);

// Motion links follow geometric attachment. The original carriage aligns the first
// well with the fixed pusher. Retracting by the well pitch aligns the second well.
export const feedCylinders = [
  {
    id:'carriage',
    name:'料井移位气缸',
    model:'SCDJB16-125',
    paths:paths([1829338, 1829339, 1829326, 1829327, 1829328, 1829329, 1829330,
                 1829331, 1829332, 1829333, 1829334]),
    // Local -Z is world +X. The file shows the extended demonstration position.
    rodZ:-1, home:.125, travel:.125, speed:.055
  },
  {
    id:'feed-push',
    name:'料柱推料气缸',
    model:'SCDJB10-80',
    paths:paths([1829346, 1829348]),
    // Local +Z is world -Z, toward the well opening.
    rodZ:1, home:0, travel:.079, speed:.038
  }
];
