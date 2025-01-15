// const updateVotes = async () => {
//     const results = await CandidatesCollection.aggregate([
//         {
//             $lookup: {
//                 from: 'votes',
//                 localField: '_id',
//                 foreignField: 'candidateId',
//                 as: 'votes',
//             },
//         },
//         {
//             $project: {
//                 name: 1,
//                 party: 1,
//                 votes: { $size: '$votes' },
//             },
//         },
//     ]).toArray();

//     io.emit('voteUpdate', results);
// };
